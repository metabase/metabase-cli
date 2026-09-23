---
name: dashboard
description: Author Metabase dashboard YAML files in the repo - dashcards on the 24-column grid, dashboard-owned cards, filters (parameters plus per-dashcard parameter_mappings with natural-key targets), tabs, series overlays, heading/text/link cards, and click behavior (crossfilter, links). Validate with `mb check`, ship with `mb save`. Triggers - "build a dashboard from these cards", "my dashboard only fills half the width", "wire a filter to these cards", "click a bar to filter the other charts", "add a dashboard tab", "overlay a second series", "why doesn't my filter do anything".
allowed-tools: Read, Write, Edit, Bash
---

# Dashboard

A dashboard is one YAML file. It holds the grid of dashcards, the filter `parameters`, and the `tabs`. Each dashcard points at a card by the card's `entity_id`. A filter works only when each target dashcard also has a `parameter_mappings` entry for it.

Read the spec sections Dashboard, Parameter, and Click Behavior, and the schema `$DIR/spec/schemas/dashboard.yaml` (see `representations` for `$DIR`). Use an existing dashboard in the repo as the template. Load `visualization` for each card's `display` and `visualization_settings`.

## A dashboard file has this shape

```yaml
name: Sales overview
entity_id: I7ecmnoFMkYs7QyXep6g9
creator_id: admin@example.com
collection_id: WszzUc4pekzdwn9nMHEDo       # the collection's entity_id
width: full                                 # or fixed (the default)
parameters: []                              # filters, below
tabs: []                                    # optional, below
dashcards:
- entity_id: p3bUfyPwOrpCazcD4EKIx          # fresh NanoID per dashcard
  card_id: 5w9ZjCIyQgqE5iuBSKzCv            # the card's entity_id; null for text/heading/link
  row: 0
  col: 0
  size_x: 6
  size_y: 3
  parameter_mappings: []
  visualization_settings: {}                # overrides the card's settings on this dashboard only
  serdes/meta:
  - id: I7ecmnoFMkYs7QyXep6g9               # the dashboard's entity_id
    model: Dashboard
  - id: p3bUfyPwOrpCazcD4EKIx               # this dashcard's entity_id
    model: DashboardCard
serdes/meta:
- id: I7ecmnoFMkYs7QyXep6g9
  label: sales_overview
  model: Dashboard
```

- Give every dashcard its own `entity_id` and a two-entry `serdes/meta`: the dashboard, then the dashcard.
- Every `card_id` must name a card file in the repo.
- A dashcard that you delete from `dashcards` leaves the dashboard on import.

## Dashboard-owned cards sit in a folder named after the dashboard

A card built for one dashboard sets `dashboard_id` to the dashboard's `entity_id`. The card must also set the same `collection_id` as the dashboard. Put the card file in a subfolder named after the dashboard's slug, next to the dashboard file:

```
collections/main/sales.yaml                                   collection
collections/main/sales/sales_overview.yaml                    dashboard
collections/main/sales/sales_overview/revenue_by_month.yaml   card with dashboard_id
collections/main/sales/orders_by_category.yaml                reusable card, no dashboard_id
```

Leave `dashboard_id` off a card that other dashboards or documents also use.

## The grid is 24 columns wide

`col` counts from 0 at the left edge. `row` grows downward. `col + size_x` must be 24 or less. Full width is `size_x: 24`, and a width of 12 is half the row. `mb check` rejects `size_x` above 24 and `col` above 23. It does not detect overlaps or `col + size_x > 24`, so do that math yourself.

Default sizes (width x height):

| `display` | Size |
| --- | --- |
| `scalar`, `smartscalar` | 6 x 3 |
| `bar`, `line`, `area`, `row`, `combo`, `scatter`, `funnel`, `progress`, `map`, `gauge`, `boxplot` | 12 x 6 |
| `pie`, `iframe` | 12 x 8 |
| `table`, `pivot`, `object` | 12 x 9 |
| `waterfall` | 14 x 6 |
| `sankey` | 16 x 10 |
| `heading` | 24 x 1 |
| `text` | 12 x 3 |
| `link` | 8 x 1 |

A standard layout has three bands:

1. A row of four KPI scalars at `col` 0, 6, 12, and 18 (6 x 3 each).
2. Charts in halves (`col` 0 and 12) below the KPIs.
3. Wide tables at `size_x: 24`.

Check the result. Each row fills to column 24. If no dashcard crosses column 12, you laid out on 12 columns: double every width.

## A filter is a parameter plus one mapping per dashcard

Add the widget to `parameters`. Then add a `parameter_mappings` entry to every dashcard that the filter controls. A parameter without mappings shows a widget that filters nothing.

```yaml
parameters:
- id: 3ba1ea5b-978c-495e-9804-794d72b11313   # unique in this dashboard; mint with uuidgen
  name: Category
  slug: category
  type: string/=
  sectionId: string
```

```yaml
# on each target dashcard
parameter_mappings:
- card_id: C4sUrYgs09JbPzHzhLNj8                # this dashcard's card_id
  parameter_id: 3ba1ea5b-978c-495e-9804-794d72b11313
  target: [dimension, [field, [Sample Database, PUBLIC, PRODUCTS, CATEGORY], null]]
```

Set `type` to one of these values:

| Group | `type` |
| --- | --- |
| Text | `string/=` `string/!=` `string/contains` `string/does-not-contain` `string/starts-with` `string/ends-with` |
| Number | `number/=` `number/!=` `number/>=` `number/<=` `number/between` |
| Date | `date/single` `date/range` `date/relative` `date/month-year` `date/quarter-year` `date/all-options` |
| Other | `boolean/=`, `temporal-unit` (time grouping; list the allowed units in `temporal_units`) |

Warning: `mb check` does not validate `type`. A value outside this table imports, but the widget breaks.

`sectionId` restricts the columns that the filter can map to. Set it to the first part of `type`. Use `id` for PK and FK columns only, or `location` for location columns only.

### The target grammar depends on the card's query

Parameter targets use the legacy field-ref order `[field, <ref>, <options-or-null>]`, with the ref second. The query order inside `dataset_query` is the reverse: `[field, {}, <ref>]`. `mb check` rejects the query order in a target.

| The card's query has | `target` |
| --- | --- |
| An MBQL column | `[dimension, [field, [Sample Database, PUBLIC, ORDERS, CREATED_AT], null]]` |
| A column through an implicit join | `[dimension, [field, [Sample Database, PUBLIC, PRODUCTS, CATEGORY], {source-field: [Sample Database, PUBLIC, ORDERS, PRODUCT_ID]}]]` |
| An MBQL expression | `[dimension, [expression, Profit]]` |
| A column of a later stage | `[dimension, [field, CATEGORY, null], {stage-number: 1}]` |
| A native `dimension` or `temporal-unit` tag | `[dimension, [template-tag, category_filter]]` |
| A native `text`, `number`, `date`, or `boolean` tag | `[variable, [template-tag, min_price]]` |
| A `{{name}}` placeholder in a text or heading card | `[text-tag, name]` (omit `card_id`) |

Copy field refs from `mb metadata <db-id> <table-id>`. Use its `fk_target` to confirm an implicit-join `source-field`. Take native tag names from the card's `template-tags` (see `native-sql`).

### Filter options

- **`default`** sets the initial value. Give a `default` to every `required: true` parameter, or its cards wait for user input.
- **Value source**: omit `values_source_type` to offer the column's distinct values. For a fixed list, set `values_source_type: static-list` and `values_source_config: {values: [...]}`. To take values from a card, set `values_source_type: card` and `values_source_config: {card_id, value_field, label_field}`. The spec Parameter section shows both shapes.
- **`values_query_type`**: `list` (dropdown), `search` (type-ahead), or `none` (free input). `mb metadata` shows a field's `values` when the field has a stored value list.
- **`inline_parameters`** on a dashcard lists the parameter ids to show on that dashcard instead of in the dashboard header.

## Tabs pair a dashboard id with a tab id

Declare the tabs on the dashboard, each with its own `entity_id`. Put a dashcard on a tab with a two-element `dashboard_tab_id`:

```yaml
tabs:
- {entity_id: Q1iLOM6YrVjkcO7D6TjMX, name: Overview, position: 0}
- {entity_id: c5rj81Krx082T3HOPyIdO, name: Details, position: 1}
dashcards:
- entity_id: 1Kx9dWq3ZbRr7TnVpLm2A
  card_id: ijurFYW4LfMeXrKodMjix
  dashboard_tab_id: [I7ecmnoFMkYs7QyXep6g9, c5rj81Krx082T3HOPyIdO]   # [dashboard, tab]
  ...
```

Each tab has its own grid that starts at `row: 0`. Deleting a tab deletes every dashcard on it. On a dashboard without tabs, omit `dashboard_tab_id`.

## Series overlay more cards on one chart

`series` on a dashcard draws more cards on its chart, in `position` order. Use it only for `line`, `area`, and `bar` cards that share the x-axis.

```yaml
series:
- {card_id: OMuZ0wHe2O5Z_59-cLmn4, position: 0}
```

## Heading, text, and link cards have no card

Set `card_id: null` and put the content in `visualization_settings`:

```yaml
visualization_settings:
  virtual_card: {display: heading}      # or text (markdown), link, iframe
  text: Sales
```

A link card uses `link: {url: ...}` or `link: {entity: {id: <entity_id>, model: dashboard}}`. The spec's Virtual Card Settings section lists every variant.

## Click behavior lives on the dashcard

Put `click_behavior` in the dashcard's `visualization_settings` to cover the whole card. For one table column, put it in `column_settings['["name","COL"]'].click_behavior`. Keys are camelCase. Don't put click behavior in a card file.

| Goal | `type` |
| --- | --- |
| Show the default drill menu | `actionMenu` (the default; omit `click_behavior`) |
| Filter the other cards with the clicked value | `crossfilter` |
| Open a URL, dashboard, or question | `link` with `linkType: url`, `dashboard`, or `question` |

**Crossfilter.** On the driver dashcard, map the clicked column to a dashboard parameter. On each follower dashcard, map the same parameter with `parameter_mappings`. The driver dashcard needs no mapping for it.

```yaml
visualization_settings:
  click_behavior:
    type: crossfilter
    parameterMapping:
      3ba1ea5b-978c-495e-9804-794d72b11313:          # the parameter id, used three times
        id: 3ba1ea5b-978c-495e-9804-794d72b11313
        source: {type: column, id: CATEGORY, name: Category}   # the card's output column
        target: {type: parameter, id: 3ba1ea5b-978c-495e-9804-794d72b11313}
```

**Link to a URL.** `{{COLUMN}}` inserts the clicked row's value. `{{filter:status}}` inserts the value of the dashboard parameter with slug or name `status`.

```yaml
click_behavior:
  type: link
  linkType: url
  linkTemplate: "https://example.com/orders/{{ID}}?status={{filter:status}}"
```

**Link to a dashboard.** Set `targetId` to the target dashboard's `entity_id`. Key `parameterMapping` by the target dashboard's parameter ids. Use the same `source` and `target` shape as crossfilter. For `linkType: question`, copy the spec's Link to Question example.

## Don't

- Don't lay out on 12 columns. Full width is `size_x: 24`.
- Don't declare a parameter without a `parameter_mappings` entry on each dashcard that it filters.
- Don't write query-order refs (`[field, {}, <ref>]`) in parameter targets.
- Don't write numeric ids. Cards, tabs, and dashboards take entity_ids. Fields take natural-key refs.
- Don't reuse an `entity_id` across dashcards or tabs. Mint a fresh one for each.
- Don't overlay `series` on a pie, scalar, or table.
