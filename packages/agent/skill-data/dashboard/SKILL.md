---
name: dashboard
description: Build Metabase dashboards with `dashboard_write` — the layout document that compiles to the canvas, the 24-column grid (`{col,row,size_x,size_y}` math, per-chart default sizes, autoplace) and the interactive layer on top of it. Covers wiring filters to cards (`parameters` + `parameter_mappings`), the `target_field` / `target_tag` / raw `target` grammar, linked/cascading filters and their foreign-key requirement, cross-filtering, click-through, multi-series overlays, text/heading/link/iframe cards, and tabs. Triggers — "build a dashboard from these cards", "my dashboard is squished into half the width", "wire a filter to these cards", "make a filter cascade", "click a bar to filter the other charts", "add a dashboard tab", "add a second series", "why isn't my filter showing".
allowed-tools: Read, Write, Edit, AskUserQuestion
---

# Dashboard

A dashboard starts as cards on a grid; it becomes an **app** when filters drive the cards, charts cross-filter each other, and clicks navigate. This skill owns both: the grid layout and the interactive layer. **`visualization`** owns each card's chart and the full `click_behavior` key catalog.

## The layout document is the whole canvas

`dashboard_write` does not take a `dashcards` array. It takes a **layout document** — `{tabs?, parameters?, dashcards}` — which it validates, resolves against the live dashboard, and compiles into the canvas. Pass it inline as `layout` for something small, or on disk as `layout_file` for anything real.

The document is the **complete** canvas: a dashcard it omits is removed. So an edit always starts from a pull.

```
{method: "pull", id: 3}                                   → writes dashboard-3.layout.json
   edit the file with your editing tools
{method: "update", id: 3, layout_file: "dashboard-3.layout.json"}
```

`pull` re-sugars everything (virtual cards, links, series), so the file you edit is the same shape you send back — a pull → update round-trip with no edits is a no-op. Add `validate_only: true` to compile without writing; the tool returns the dashcards, tabs and parameters it would have sent.

**Identity is the `id` field.** A dashcard or tab with a **positive** `id` must already exist on the dashboard — a typo dies client-side naming `dashcards[i]`. A dashcard **without** an `id` is new. New tabs may carry a **negative** id so dashcards can reference them via `tab_id`. A new parameter's `id` defaults to a slug of its `name`.

Dashboard-level fields are top-level tool arguments, not layout keys, and need no layout at all: `name`, `description`, `collection_id`, `collection_position`, `archived`, `width` (`fixed` | `full`), `auto_apply_filters`, `cache_ttl`. `{method: "update", id: 3, archived: true}` trashes a dashboard without touching its canvas.

To read a dashboard without pulling a file: `get_content` with `{items: [{type: "dashboard", id: 3}], include: ["layout", "parameters"]}`.

## Layout: the grid is 24 columns — not 12

Every dashcard carries `{col, row, size_x, size_y}` in grid units: `col` is 0-indexed from the left edge, `row` grows downward, and `col + size_x ≤ 24`. **Full-width is `size_x: 24` — the per-chart _default_ width of 12 is half a row.** A layout authored on the usual 12-column web-grid assumption crams the whole dashboard into the left half of the viewport. An explicit position that runs off the grid is a compile error naming the dashcard.

`row` and `col` come **together**: give both for an explicit position, or **neither** to autoplace. Autoplace takes the first free slot scanning rows then columns, per tab; explicitly positioned cards claim their slots first, then the rest fill in document order. `size_x`/`size_y` omitted fall back to the display's default.

Default sizes (w×h): `scalar`/`smartscalar` 6×3, `pie` 12×8, `table`/`list`/`pivot`/`object` 12×9, `waterfall` 14×6, `sankey` 16×10, `heading` 24×1, `text` 12×3, `link` 8×1, `iframe` 12×8, `action` 4×1, every other chart 12×6.

The standard shape — a KPI row of scalars across the full 24, charts in halves or thirds below, wide tables full-width:

```jsonc
"dashcards": [
  { "card_id": 101, "col": 0,  "row": 0, "size_x": 6,  "size_y": 3 },  // 4 KPIs × 6 = 24
  { "card_id": 102, "col": 6,  "row": 0, "size_x": 6,  "size_y": 3 },
  { "card_id": 103, "col": 12, "row": 0, "size_x": 6,  "size_y": 3 },
  { "card_id": 104, "col": 18, "row": 0, "size_x": 6,  "size_y": 3 },
  { "card_id": 105, "col": 0,  "row": 3, "size_x": 12, "size_y": 6 },  // two halves
  { "card_id": 106, "col": 12, "row": 3, "size_x": 12, "size_y": 6 },
  { "card_id": 107, "col": 0,  "row": 9, "size_x": 24, "size_y": 9 }   // full-width table
]
```

**Sanity-check before sending:** rows should fill to 24 and at least one card must end at `col + size_x = 24`. If nothing in the array crosses column 12, you've authored a 12-column layout — double every width.

## A dashcard carries exactly one content source

`card_id` (a saved question, model or metric), `text`, `heading`, `link`, `iframe`, or `action_id` — one and only one. Text, heading, link and iframe are sugar: you write the field, the tool builds the `virtual_card` blob the API stores, and `pull` lifts it back out.

```jsonc
{ "heading": "Revenue" }                                  // 24×1 by default
{ "text": "Figures exclude refunds." }                    // markdown
{ "link": { "url": "https://runbook.example/oncall" } }
{ "link": { "entity": { "type": "dashboard", "id": 7 } } }  // question|model|metric|dashboard|collection|table
{ "iframe": "https://example.com/embed" }
```

A link takes **exactly one** of `url` or `entity`. Anything else in `visualization_settings` on a dashcard passes through verbatim — that's where a card's dashboard-level chart overrides and its `click_behavior` live.

## The wiring loop: a filter is a parameter + a mapping per card

A dashboard filter is one entry in the layout's `parameters` array **plus** a `parameter_mappings` entry on every dashcard it should control. A parameter with no mapping is an inert widget — the most common "my filter does nothing" cause.

```jsonc
{
  "parameters": [
    { "id": "status", "name": "Status", "type": "string/=" }
  ],
  "dashcards": [
    { "card_id": 42, "parameter_mappings": [{ "parameter_id": "status", "target_field": 1779 }] }
  ]
}
```

A parameter takes `{id?, name, type, slug?, sectionId?, default?, required?, isMultiSelect?, filteringParameters?, temporal_units?, values_query_type?, values_source_type?, values_source_config?}`. Omit `id` and it is minted from the name; omit `slug`/`sectionId` and they are derived from the name and the type.

`type` is a **closed enum** — an unlisted value is rejected before the write, with the allowed set echoed back: string ops `string/=` `string/!=` `string/contains` `string/does-not-contain` `string/starts-with` `string/ends-with`; number ops `number/=` `number/!=` `number/between` `number/>=` `number/<=`; date `date/single` `date/range` `date/relative` `date/month-year` `date/quarter-year` `date/all-options`; location `location/city` `location/state` `location/zip_code` `location/country`; plus `category`, `id`, `boolean/=`, `temporal-unit`, and bare `number`/`text`/`date`/`boolean`.

### The mapping target

A mapping is `{parameter_id, target_field | target_tag | target}` — **exactly one** of the three targets. `parameter_id` must name a parameter in the same document, or the compile fails listing the ones it declares.

| Card's query                | Mapping                                                      |
| --------------------------- | ------------------------------------------------------------ |
| MBQL column                 | `"target_field": 1779` — the field id                        |
| Native **field filter** tag | `"target_tag": "status"` — binds as a dimension              |
| Native **raw variable** tag | `"target_tag": "status"` — binds as a variable               |
| Text / heading card         | `"target_tag": "name"` — binds as a text tag                 |
| Anything else               | `"target": ["dimension", ["field", 1779, null]]` — raw       |

**`target_tag` resolves its own kind.** The tool reads the card's query, finds the template tag by name, and binds it as a `dimension` (tag type `dimension`) or a `variable` (tag type `text`/`number`/`date`/`boolean`) accordingly — you never choose between the two. A tag the card doesn't declare is a compile error naming the tags it does declare. On a text or heading dashcard, `target_tag` binds the `{{tag}}` in its markdown.

`target` is the escape hatch for a target neither sugar expresses; it takes the wire grammar verbatim (`["dimension", ["field", <id>, null]]`, `["dimension", ["template-tag", "<tag>"]]`, `["variable", ["template-tag", "<tag>"]]`, `["text-tag", "<tag>"]`). A pulled layout writes its existing mappings in this raw form — leave them alone unless you're re-pointing one.

Field ids come from `browse_data` (`get_fields` on the table); native tag names from the card's query — the grammar is in `native-sql`.

**`inline_parameters`** moves a filter widget out of the dashboard header and onto one card: list the parameter id on that dashcard. A parameter is inline on at most one card — claiming it twice is a compile error.

## Choose the interaction

Four distinct mechanisms — pick by what the user wants clicking or filtering to _do_:

| Want                                               | Mechanism                                             |
| -------------------------------------------------- | ----------------------------------------------------- |
| One widget filters several cards                   | a **dashboard parameter** mapped to each card (above) |
| One filter's choices narrow another's              | a **linked filter** (`filteringParameters`)           |
| Clicking a chart filters the other charts          | **cross-filter** click behavior                       |
| Clicking navigates to a question / dashboard / URL | **link** click behavior                               |

### Linked (cascading) filters

Make a child filter (City) show only values consistent with a parent (State) by listing the parent's id in the child parameter's `filteringParameters`:

```json
{ "id": "city", "name": "City", "type": "category", "filteringParameters": ["state"] }
```

The named parent must be a parameter in the same layout — otherwise the compile fails listing the ids the document declares.

Two hard constraints, both from the same root: **linked filters read table-metadata foreign keys only.** They ignore joins defined inside a saved question or model. So the parent and child columns must be connected by a FK set in metadata — if the cascade shows values it shouldn't, the FK is missing (fix it with `metadata_write`'s `update_field`, then retry; the semantics are in `metadata`). And `filteringParameters` is **incompatible with a `values_source_type` of `static-list` or `card`** — a custom value source overrides the cascade, so Metabase clears the link. Leave the child's value source live (omit it) for linked filtering to work.

### Cross-filtering (click a chart to filter the rest)

Set the **driver** chart's whole-card click behavior to `crossfilter`, mapping the clicked value into a dashboard parameter; map that same parameter onto the **follower** cards normally. The driver stays unmapped to it (it emits the value; it doesn't consume it). `click_behavior` lives in the dashcard's `visualization_settings` (whole card) or `column_settings[<col>].click_behavior` (per column on tables), with **camelCase** keys:

```json
{
  "card_id": 42,
  "visualization_settings": {
    "click_behavior": {
      "type": "crossfilter",
      "parameterMapping": {
        "status": {
          "id": "status",
          "source": { "type": "column", "id": "STATUS", "name": "Status" },
          "target": { "type": "parameter", "id": "status" }
        }
      }
    }
  }
}
```

### Click-through (navigate)

```json
{ "click_behavior": { "type": "link", "linkType": "dashboard",
    "targetId": 7, "parameterMapping": { } } }
```

`linkType` is `question` / `dashboard` (carry a `parameterMapping` to pass the clicked context) or `url` (a `linkTemplate` like `"https://app/orders/{{ORDER_ID}}"`, `{{Column}}` interpolated). The full `click_behavior`/`parameterMapping` key catalog is in `visualization`'s settings reference — don't hand-author a complex one; build it once in the UI, then `pull` the layout and copy it out. Note: a **native-SQL card can't drill through** — only cross-filter and link click behaviors work on it.

## Series, tabs, value sources

**Multi-series overlay** — put several cards on one chart (**line / area / bar only**): the dashcard's `series` is an array of card ids in draw order (`"series": [43, 51]`), and it only belongs on a dashcard that has a `card_id`. Every id must resolve to a readable card or the compile fails.

**Tabs** — `tabs` is `[{ "name": "Overview" }, …]` in display order; a dashcard joins a tab via `tab_id`. Give a **new** tab a negative id (`{"id": -1, "name": "Detail"}`) so new dashcards can point at it with `tab_id: -1`; the write returns the real ids. A dashcard with no `tab_id` lands on the first tab. A filter widget only appears on a tab if it's mapped to at least one card on **that** tab.

**Filter value source** (the dropdown behind a parameter) — omit `values_source_type` to pull live distinct values from the mapped column; `"static-list"` + `values_source_config.values` for a fixed list; `"card"` + `values_source_config` `{card_id, value_field, label_field}` to source from a query. `values_query_type` (`list` / `search` / `none`) picks the widget. `get_parameter_values` with `{target: "dashboard", id, parameter_id}` previews exactly what a widget will offer — `query` narrows to a substring, and `constraints` (a map of other parameter ids to their selected values) shows what a cascade will leave.

## Gotchas

- **Auto-connect / the missing map:** a filter that "does nothing" or "won't show" is almost always unmapped, or mapped only to cards on another tab.
- **Time-grouping parameters** (`temporal-unit`) bind only to a datetime column in the query's **last** stage — add one after a time-bucketed summary and it can't attach. Constrain the offered units with `temporal_units`.
- **Required + default:** a `required: true` parameter with no `default` blocks its cards until a value is chosen; give it a `default` for expensive queries you don't want running unfiltered.
- **The document is the canvas:** authoring an update layout from memory deletes every dashcard you forgot. Start from `{method: "pull", id}` and edit the file.

## Don't

- Don't lay out on a 12-column assumption — full-width is `size_x: 24`; a layout where no card crosses column 12 renders in the left half of the viewport.
- Don't declare a parameter and forget the per-card `parameter_mappings` — the widget won't filter anything.
- Don't expect a linked filter to work off a model/question join, a custom column, or with a static/card value source — it needs a metadata FK and a live source.
- Don't hand-author a complex `click_behavior` — copy a UI-built one out of a pull.
- Don't add a second `series` to a pie/scalar/table — it's line/area/bar only.
- Don't send a half-remembered layout to `update` — pull first, or you delete what you omit.
