---
name: dashboard
description: Build Metabase dashboards as files, laying out dashcards on the 24-column grid (`{col,row,size_x,size_y}` math, per-chart default sizes) and turning cards into a filterable, cross-linked page. Covers wiring filters to cards (parameters and parameter_mappings), the target grammar for MBQL columns and native tags, linked filters and their foreign-key requirement, cross-filtering, click-through, series overlays, and tabs. Triggers are "build a dashboard from these cards", "my dashboard is squished into half the width", "wire a filter", "make a filter cascade", "click a bar to filter the rest", "add a tab", "why isn't my filter showing".
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

# Dashboard

A dashboard starts as cards on a grid; it becomes an app when filters drive the cards, charts cross-filter each other, and clicks navigate. This skill owns both the layout and the interactive layer. A dashboard is a file (`mb skills get metabase-representation-format`, "Dashboard" in `spec.md`); each card's chart and the full `click_behavior` catalog are the `visualization` skill's.

## The file

The dashboard file sits in its collection's folder and holds `parameters`, `tabs` and `dashcards` whole. There are no partial edits: the file is the dashboard, and what it omits is gone after the import. Every dashcard, tab and card reference uses `entity_id`s; mint new ones with `mb entity-id`, mint parameter ids with `mb uuid`.

```yaml
name: Orders overview
entity_id: <mb entity-id>
creator_id: <email>
collection_id: <collection entity_id>
width: fixed
parameters:
  - id: <mb uuid>
    name: Status
    slug: status
    type: string/=
dashcards:
  - entity_id: <mb entity-id>
    card_id: <card entity_id>
    row: 0
    col: 0
    size_x: 12
    size_y: 6
    parameter_mappings:
      - card_id: <card entity_id>
        parameter_id: <the parameter's id>
        target: [dimension, [field, [Sample Database, PUBLIC, ORDERS, STATUS], null]]
    visualization_settings: {}
    serdes/meta:
      - id: <dashboard entity_id>
        model: Dashboard
      - id: <dashcard entity_id>
        model: DashboardCard
serdes/meta:
  - id: <dashboard entity_id>
    label: orders_overview
    model: Dashboard
```

A card that exists only for this dashboard sets `dashboard_id` to the dashboard's `entity_id` and the same `collection_id`, and its file sits in a folder named like the dashboard. Inspect what the instance holds with `mb dashboard get <id> --json` (hydrates `parameters`, `dashcards`, `tabs`) and `mb dashboard cards <id>`.

## Layout: the grid is 24 columns, not 12

Every dashcard carries `{col, row, size_x, size_y}` in grid units: `col` is 0-indexed from the left, `row` grows downward, and `col + size_x ≤ 24`. **Full width is `size_x: 24`; the per-chart default width of 12 is half a row.** A layout authored on a 12-column assumption crams the dashboard into the left half. Overlaps and gaps are stored as written.

Default sizes (w×h): `scalar`/`smartscalar` 6×3, `pie` 12×8, `table`/`pivot`/`object` 12×9, `waterfall` 14×6, `sankey` 16×10, `heading` 24×1, `text` 12×3, every other chart 12×6.

The standard shape, a KPI row of scalars across the full 24, charts in halves or thirds, wide tables full width:

```yaml
- { col: 0, row: 0, size_x: 6, size_y: 3 } # 4 KPIs x 6 = 24
- { col: 6, row: 0, size_x: 6, size_y: 3 }
- { col: 12, row: 0, size_x: 6, size_y: 3 }
- { col: 18, row: 0, size_x: 6, size_y: 3 }
- { col: 0, row: 3, size_x: 12, size_y: 6 } # two halves
- { col: 12, row: 3, size_x: 12, size_y: 6 }
- { col: 0, row: 9, size_x: 24, size_y: 9 } # full-width table
```

**Check before validating:** rows fill to 24 and at least one card ends at `col + size_x = 24`. If nothing crosses column 12, you authored a 12-column layout; double every width.

A text or heading dashcard is virtual: `card_id: null`, `visualization_settings: {virtual_card: {display: text}, text: "…"}`.

## Wiring: a filter is a parameter plus a mapping per card

A filter is one entry in `parameters` plus a `parameter_mappings` entry on every dashcard it controls. A parameter with no mapping is an inert widget, the most common "my filter does nothing".

- **`id`** is any unique non-empty string; mint it with `mb uuid` rather than inventing one.
- **`type`** is a closed enum: `string/=` `string/!=` `string/contains` `string/does-not-contain` `string/starts-with` `string/ends-with`; `number/=` `number/!=` `number/between` `number/>=` `number/<=`; `date/single` `date/range` `date/relative` `date/month-year` `date/quarter-year` `date/all-options`; `boolean/=`; `temporal-unit`; plus `category`, `id`, and `location/city` `location/state` `location/zip_code` `location/country`. The server refuses any other value on import. `sectionId: id` or `sectionId: location` narrows which columns it maps to.

The mapping `target` uses the **legacy** field order, field second, unlike the query itself:

| Card's query                             | `target`                                                     |
| ---------------------------------------- | ------------------------------------------------------------ |
| MBQL column                              | `[dimension, [field, [db, schema, table, field], null]]`     |
| MBQL column of a later stage             | `[dimension, [field, COLUMN_NAME, null], {stage-number: 1}]` |
| MBQL expression                          | `[dimension, [expression, Name]]`                            |
| Native field filter or time grouping tag | `[dimension, [template-tag, <tag>]]`                         |
| Native raw variable                      | `[variable, [template-tag, <tag>]]`                          |
| Text card placeholder `{{name}}`         | `[text-tag, name]`                                           |

Table and field names come from `mb table get <id> --include fields` (the `core` skill's db traversal); native tags from the `native-sql` skill. After the import, `mb dashboard parameter-values <id> <parameter-id>` lists what a widget offers; an empty list means the mapping or the field values are missing.

## Choose the interaction

| Want                                               | Mechanism                               |
| -------------------------------------------------- | --------------------------------------- |
| One widget filters several cards                   | a parameter mapped to each card (above) |
| One filter's choices narrow another's              | a linked filter (`filteringParameters`) |
| Clicking a chart filters the other charts          | cross-filter click behavior             |
| Clicking navigates to a question, dashboard or URL | link click behavior                     |

### Linked (cascading) filters

A child filter (City) shows only values consistent with a parent (State) when the child parameter lists the parent's id in `filteringParameters`:

```yaml
- id: <city id>
  name: City
  slug: city
  type: string/=
  filteringParameters: [<state id>]
```

Linked filters read **table-metadata foreign keys only**; they ignore joins inside a question or model. The parent and child columns must be connected by a FK set in metadata (the `metadata` skill); a cascade showing values it shouldn't means the FK is missing. `filteringParameters` also does not combine with a `values_source_type` of `static-list` or `card`; leave the child's value source live.

### Cross-filtering

Set the driver chart's whole-card click behavior to `crossfilter`, mapping the clicked value into a dashboard parameter, and map that parameter onto the follower cards normally. The driver stays unmapped to it. `click_behavior` lives in the dashcard's `visualization_settings` (whole card) or `column_settings['["name","COL"]'].click_behavior` (per column on a table):

```yaml
visualization_settings:
  click_behavior:
    type: crossfilter
    parameterMapping:
      <parameter id>:
        id: <parameter id>
        source: { type: column, id: STATUS, name: Status }
        target: { type: parameter, id: <parameter id> }
```

### Click-through

`type: link` with `linkType: dashboard` or `question` and `targetId` set to the target's `entity_id` (carry a `parameterMapping` to pass the clicked context), or `linkType: url` with a `linkTemplate` like `"https://app/orders/{{ORDER_ID}}"`. The full key catalog is in `visualization`'s settings reference. A native-SQL card cannot drill through; only cross-filter and link work on it.

## Series, tabs, value sources

**Series overlay** (line, area and bar only): the dashcard's `series` is `[{card_id: <entity_id>, position: 0}, …]` in draw order.

**Tabs:** `tabs: [{entity_id: <mb entity-id>, name: Overview, position: 0}, …]`; a dashcard joins one with `dashboard_tab_id: <tab entity_id>`. Removing a tab removes its dashcards. A filter widget shows on a tab only when it maps to a card on that tab.

**Filter value source:** omit `values_source_type` for live distinct values from the mapped column; `static-list` with `values_source_config.values`; or `card` with `{card_id: <entity_id>, value_field, label_field}`.

## Gotchas

- **The missing map:** a filter that does nothing or won't show is unmapped, or mapped only to cards on another tab.
- **Time-grouping parameters** (`temporal-unit`) bind only to a datetime column in the query's last stage.
- **Required with no default:** a `required: true` parameter without `default` blocks its cards until a value is chosen.
- **Whole-file edits:** a dashcard or parameter left out of the file is deleted on import. Edit the file in place; never rebuild it from a partial list.

## Don't

- Don't lay out on a 12-column assumption.
- Don't declare a parameter and forget the per-card `parameter_mappings`.
- Don't write a mapping target in the query's field order; targets use `[field, <field>, null]`.
- Don't expect a linked filter to work off a question's join, a custom column, or a static or card value source.
- Don't add a series to a pie, scalar or table.
