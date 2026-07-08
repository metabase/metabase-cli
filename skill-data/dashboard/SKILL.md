---
name: dashboard
description: Build Metabase dashboards via the `mb` CLI — lay out dashcards on the 24-column grid (`{col,row,size_x,size_y}` math, per-chart default sizes) and turn cards into a filterable, cross-linked app. Covers wiring filters to cards (parameters + parameter_mappings), the field-filter vs. raw-variable target grammar, linked/cascading filters and their foreign-key requirement, cross-filtering, click-through, multi-series overlays, and tabs. The parameter type enum and whole-array replace semantics live in `core`. Triggers — "build a dashboard from these cards", "my dashboard is squished into half the width", "wire a filter to these cards", "make a filter cascade", "click a bar to filter the other charts", "add a dashboard tab", "add a second series", "why isn't my filter showing".
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

# Dashboard

A dashboard starts as cards on a grid; it becomes an **app** when filters drive the cards, charts cross-filter each other, and clicks navigate. This skill owns both: the grid layout and the interactive layer.

**`core` owns the transport mechanics** — the whole-array replace semantics (editing `dashcards` or `parameters` replaces the entire set; omitted entries are deleted; new cards use negative ids), `update-dashcard` for a single safe patch vs. `update --body` for a full replace, the closed `parameter.type` enum, and the `parameter-values` verb. Read it first (`mb skills get core`). **`visualization`** owns each card's chart and the full `click_behavior` key catalog.

Inspect before you wire: `mb dashboard get <id> --json` hydrates `parameters`, `dashcards`, and `tabs`; `mb dashboard cards <id>` lists just the dashcards.

## Layout: the grid is 24 columns — not 12

Every dashcard carries `{col, row, size_x, size_y}` in grid units: `col` is 0-indexed from the left edge, `row` grows downward, and `col + size_x ≤ 24`. **Full-width is `size_x: 24` — Metabase's per-chart _default_ width of 12 is half a row.** A layout authored on the usual 12-column web-grid assumption crams the whole dashboard into the left half of the viewport. The server stores whatever geometry you send — overlaps and gaps included, no auto-fix.

Default sizes (w×h): `scalar`/`smartscalar` 6×3, `pie` 12×8, `table`/`pivot`/`object` 12×9, `waterfall` 14×6, `sankey` 16×10, `heading` 24×1, `text` 12×3, every other chart 12×6.

The standard shape — a KPI row of scalars across the full 24, charts in halves or thirds below, wide tables full-width:

```jsonc
"dashcards": [
  { "id": -1, "card_id": 101, "col": 0,  "row": 0, "size_x": 6,  "size_y": 3 },  // 4 KPIs × 6 = 24
  { "id": -2, "card_id": 102, "col": 6,  "row": 0, "size_x": 6,  "size_y": 3 },
  { "id": -3, "card_id": 103, "col": 12, "row": 0, "size_x": 6,  "size_y": 3 },
  { "id": -4, "card_id": 104, "col": 18, "row": 0, "size_x": 6,  "size_y": 3 },
  { "id": -5, "card_id": 105, "col": 0,  "row": 3, "size_x": 12, "size_y": 6 },  // two halves
  { "id": -6, "card_id": 106, "col": 12, "row": 3, "size_x": 12, "size_y": 6 },
  { "id": -7, "card_id": 107, "col": 0,  "row": 9, "size_x": 24, "size_y": 9 }   // full-width table
]
```

**Sanity-check before sending:** rows should fill to 24 and at least one card must end at `col + size_x = 24`. If nothing in the array crosses column 12, you've authored a 12-column layout — double every width.

## The wiring loop: a filter is a parameter + a mapping per card

A dashboard filter is one entry in the dashboard's `parameters` array **plus** a `parameter_mappings` entry on every dashcard it should control. A parameter with no mapping is an inert widget — the most common "my filter does nothing" cause.

```jsonc
// dashboard.parameters — the widget
{ "id": "status", "name": "Status", "slug": "status", "type": "string/=" }

// on each target dashcard — bind the widget to a column of that card
{ "parameter_id": "status", "card_id": 42,
  "target": ["dimension", ["field", 1779, null]] }
```

The `target` grammar depends on what the card is:

| Card's query                | `target`                                     |
| --------------------------- | -------------------------------------------- |
| MBQL column                 | `["dimension", ["field", <field-id>, null]]` |
| Native **field filter** tag | `["dimension", ["template-tag", "<tag>"]]`   |
| Native **raw variable** tag | `["variable", ["template-tag", "<tag>"]]`    |

(Field ids from `table get <id> --include fields`; native tags from `native-sql`.) Because editing replaces the whole set, adding a filter is read-modify-write: `dashboard get <id> --json`, append to `parameters` and to each dashcard's `parameter_mappings`, send the full arrays back. To wire one card without touching the rest, `update-dashcard <dash-id> <dashcard-id> --body '{"parameter_mappings":[…]}'`.

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
{ "id": "city", "type": "category", "filteringParameters": ["state"] }
```

Two hard constraints, both from the same root: **linked filters read table-metadata foreign keys only.** They ignore joins defined inside a saved question or model. So the parent and child columns must be connected by a FK set in metadata — if the cascade shows values it shouldn't, the FK is missing (fix it via `metadata`, then retry). And `filteringParameters` is **incompatible with a `values_source_type` of `static-list` or `card`** — a custom value source overrides the cascade, so Metabase clears the link. Leave the child's value source live (omit it) for linked filtering to work.

### Cross-filtering (click a chart to filter the rest)

Set the **driver** chart's whole-card click behavior to `crossfilter`, mapping the clicked value into a dashboard parameter; map that same parameter onto the **follower** cards normally. The driver stays unmapped to it (it emits the value; it doesn't consume it). `click_behavior` lives in the dashcard's `visualization_settings` (whole card) or `column_settings[<col>].click_behavior` (per column on tables), with **camelCase** keys:

```json
{
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
```

### Click-through (navigate)

```json
{ "click_behavior": { "type": "link", "linkType": "dashboard",
    "targetId": 7, "parameterMapping": { … } } }
```

`linkType` is `question` / `dashboard` (carry a `parameterMapping` to pass the clicked context) or `url` (a `linkTemplate` like `"https://app/orders/{{ORDER_ID}}"`, `{{Column}}` interpolated). The full `click_behavior`/`parameterMapping` key catalog is in `visualization`'s settings reference — don't hand-author a complex one; build it once in the UI and copy it (`mb dashboard get <id> --full --json`). Note: a **native-SQL card can't drill through** — only cross-filter and link click behaviors work on it.

## Series, tabs, value sources

**Multi-series overlay** — put several cards on one chart (**line / area / bar only**): the dashcard's `series` is an array of card ids in draw order (`"series": [43, 51]`). Sending it replaces the set; an empty array clears it. Patch with `update-dashcard`.

**Tabs** — `tabs` is `[{ "name": "Overview", "position": 0 }, …]`; a dashcard joins a tab via `dashboard_tab_id`. Creating tabs and cards together uses **negative ids** (per `core`): give a new tab `id: -1`, point new dashcards at `dashboard_tab_id: -1`, and the create/update response returns the real ids. A filter widget only appears on a tab if it's mapped to at least one card on **that** tab.

**Filter value source** (the dropdown behind a parameter) — omit `values_source_type` to pull live distinct values from the mapped column; `"static-list"` + `values_source_config.values` for a fixed list; `"card"` + `{card_id, value_field, label_field}` to source from a query. `mb dashboard parameter-values <id> <param-id> [--query <substr>]` previews what a widget will offer.

## Gotchas

- **Auto-connect / the missing map:** a filter that "does nothing" or "won't show" is almost always unmapped, or mapped only to cards on another tab.
- **Time-grouping parameters** (`temporal-unit`) bind only to a datetime column in the query's **last** stage — add one after a time-bucketed summary and it can't attach.
- **Required + default:** a `required: true` parameter with no `default` blocks its cards until a value is chosen; give it a `default` for expensive queries you don't want running unfiltered.
- **Whole-array replace:** never send a partial `parameters`/`dashcards` array to `update` — you'll delete what you omit. Use `update-dashcard` for a single-card change.

## Don't

- Don't lay out on a 12-column assumption — full-width is `size_x: 24`; a layout where no card crosses column 12 renders in the left half of the viewport.
- Don't declare a parameter and forget the per-card `parameter_mappings` — the widget won't filter anything.
- Don't expect a linked filter to work off a model/question join, a custom column, or with a static/card value source — it needs a metadata FK and a live source.
- Don't hand-author a complex `click_behavior` — copy a UI-built one.
- Don't add a second `series` to a pie/scalar/table — it's line/area/bar only.
