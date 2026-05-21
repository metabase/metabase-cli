# visualization_settings — full key catalog

Exhaustive reference for `visualization_settings`. The SKILL.md body covers the
common cases; this file is the long tail. Keys are grouped by the `display` they
apply to (see the display → namespace map in the body).

**Form note.** Every key name and value enum below is identical in the API/numeric
form (`mb card create`) and the portable git-sync YAML form. The only form-specific
constructs are (1) `column_settings` `["ref", …]` keys, where the inner field id is
numeric in the API form and a name-path in the portable form, and (2) click-behavior
dimension targets, same rule. All the column-naming keys (`graph.dimensions`,
`pie.dimension`, `table.columns[].name`, …) are output column-name strings in both.

JSON-body reminder: examples here are shown as YAML/JSON fragments. In a real
`--body`/`--file` JSON payload, `column_settings` keys are JSON **strings** with
escaped inner quotes: `"[\"name\",\"TOTAL\"]"`.

---

## Common

| Setting               | Type    | Description                                                         |
| --------------------- | ------- | ------------------------------------------------------------------- |
| `column_settings`     | map     | Per-column formatting, keyed by column-reference string (see below) |
| `card.title`          | string  | Override the card's display title on a dashboard                    |
| `card.description`    | string  | Override the description                                            |
| `dashcard.background` | boolean | Show/hide the dashcard background (dashcards only)                  |

## Graph (`bar`, `line`, `area`, `combo`, `scatter`, `waterfall`, `row`, `boxplot`)

| Setting                                 | Type           | Values / notes                                                           |
| --------------------------------------- | -------------- | ------------------------------------------------------------------------ |
| `graph.dimensions`                      | array          | Dimension (x-axis) output column names                                   |
| `graph.metrics`                         | array          | Metric (y-axis) output column names                                      |
| `graph.series_order`                    | array          | Explicit series display order                                            |
| `graph.show_values`                     | boolean        | Show value labels on data points                                         |
| `graph.label_values_frequency`          | string         | `"fit"`, `"all"`                                                         |
| `graph.show_stack_values`               | string         | `"total"`, `"individual"`, `"all"`                                       |
| `graph.x_axis.title_text`               | string         | X-axis title                                                             |
| `graph.x_axis.scale`                    | string         | `"ordinal"`, `"histogram"`, `"timeseries"`, `"linear"`, `"pow"`, `"log"` |
| `graph.x_axis.axis_enabled`             | boolean/string | `true`, `false`, `"compact"`, `"rotate-45"`, `"rotate-90"`               |
| `graph.y_axis.title_text`               | string         | Y-axis title                                                             |
| `graph.y_axis.scale`                    | string         | `"linear"`, `"pow"`, `"log"`                                             |
| `graph.y_axis.auto_range`               | boolean        | Auto-scale Y axis                                                        |
| `graph.y_axis.min` / `graph.y_axis.max` | number         | Y bounds when `auto_range` is false                                      |
| `graph.show_goal`                       | boolean        | Show goal line                                                           |
| `graph.goal_value`                      | number         | Goal line value                                                          |
| `graph.goal_label`                      | string         | Goal line label                                                          |
| `graph.show_trendline`                  | boolean        | Show trend line                                                          |
| `graph.max_categories_enabled`          | boolean        | Limit number of categories                                               |
| `graph.max_categories`                  | number         | Maximum categories shown                                                 |
| `graph.other_category_aggregation_fn`   | string         | `"sum"`, `"avg"`, `"min"`, `"max"`                                       |
| `stackable.stack_type`                  | string         | `null`, `"stacked"`, `"normalized"`                                      |

### Series settings

Per-series overrides keyed by series name (the metric column name, or the breakout
value for a split series):

```yaml
series_settings:
  Revenue:
    display: line # override this series' type in a combo chart
    color: "#509EE3"
    "line.style": solid # "solid", "dashed", "dotted"
    "line.size": normal # "S", "M", "L"
    "line.interpolate": linear # "linear", "cardinal", "step-before", "step-after"
    "line.missing": interpolate # "interpolate", "zero", "none"
    "line.marker_enabled": true
    axis: left # "left", "right"
    show_series_values: true
```

### Waterfall extras (`display: waterfall`)

| Setting                    | Type    | Description             |
| -------------------------- | ------- | ----------------------- |
| `waterfall.increase_color` | string  | Color for increases     |
| `waterfall.decrease_color` | string  | Color for decreases     |
| `waterfall.total_color`    | string  | Color for the total bar |
| `waterfall.show_total`     | boolean | Show the total bar      |

### BoxPlot extras (`display: boxplot`)

| Setting                | Type    | Values                                 |
| ---------------------- | ------- | -------------------------------------- |
| `boxplot.whisker_type` | string  | `"min-max"`, `"tukey"`, `"percentile"` |
| `boxplot.points_mode`  | string  | `"none"`, `"outliers"`, `"all"`        |
| `boxplot.show_mean`    | boolean | Show mean marker                       |

## Pie (`display: pie`)

| Setting                  | Type    | Values                                    |
| ------------------------ | ------- | ----------------------------------------- |
| `pie.dimension`          | string  | Dimension column name                     |
| `pie.metric`             | string  | Metric column name                        |
| `pie.show_legend`        | boolean |                                           |
| `pie.show_total`         | boolean | Show total in center                      |
| `pie.percent_visibility` | string  | `"off"`, `"legend"`, `"inside"`, `"both"` |
| `pie.slice_threshold`    | number  | Min percentage to show as its own slice   |
| `pie.colors`             | object  | Color map keyed by dimension value        |

## Scalar / Number (`display: scalar`, `number`)

| Setting                           | Type    | Values                          |
| --------------------------------- | ------- | ------------------------------- |
| `scalar.field`                    | string  | Output column to display        |
| `scalar.switch_positive_negative` | boolean | Invert positive/negative colors |
| `scalar.compact_primary_number`   | string  | `"auto"`, `"yes"`, `"no"`       |

### Smart scalar (`display: smartscalar`)

```yaml
scalar.comparisons:
  - id: comp1
    type: previousPeriod # vs. previous time period
  - id: comp2
    type: previousValue # vs. previous value
  - id: comp3
    type: periodsAgo # vs. N periods ago
    value: 12
  - id: comp4
    type: staticNumber # vs. fixed number
    value: 1000
    label: Target
```

## Funnel (`display: funnel`)

| Setting            | Type   | Values                |
| ------------------ | ------ | --------------------- |
| `funnel.dimension` | string | Dimension column      |
| `funnel.metric`    | string | Metric column         |
| `funnel.type`      | string | `"funnel"` or `"bar"` |
| `funnel.rows`      | array  | Row order definitions |

## Gauge (`display: gauge`)

| Setting                | Type  | Description                                 |
| ---------------------- | ----- | ------------------------------------------- |
| `gauge.segments`       | array | Segments, each `{ min, max, color, label }` |
| `gauge.segment_colors` | array | Segment colors                              |

## Map (`display: map`)

| Setting                                        | Type   | Values                           |
| ---------------------------------------------- | ------ | -------------------------------- |
| `map.type`                                     | string | `"region"`, `"pin"`, `"grid"`    |
| `map.latitude_column`                          | string | Latitude column name             |
| `map.longitude_column`                         | string | Longitude column name            |
| `map.metric_column`                            | string | Metric column for coloring       |
| `map.region`                                   | string | Region map identifier            |
| `map.pin_type`                                 | string | `"tiles"`, `"markers"`, `"heat"` |
| `map.colors`                                   | array  | Color scale                      |
| `map.zoom`                                     | number | Initial zoom level               |
| `map.center_latitude` / `map.center_longitude` | number | Map center                       |

## Table (`display: table`)

| Setting                   | Type    | Description                                               |
| ------------------------- | ------- | --------------------------------------------------------- |
| `table.columns`           | array   | Column order + visibility; each entry `{ name, enabled }` |
| `table.column_formatting` | array   | Conditional formatting rules (see below)                  |
| `table.pivot`             | boolean | Enable in-table pivot mode                                |
| `table.pivot_column`      | string  | Column to pivot on                                        |
| `table.cell_column`       | string  | Column used for cell values (pivot mode)                  |

### Conditional formatting (`table.column_formatting`)

```yaml
table.column_formatting:
  - columns: [Total]
    type: single # "single" or "range"
    operator: ">" # "=", "!=", "<", ">", "<=", ">=", "is-null", "not-null"
    value: 100
    color: "#84BB4C"
    highlight_row: false
  - columns: [Rating]
    type: range
    colors: ["#ED6E6E", "#F9CF48", "#84BB4C"]
    min_type: custom # "min", "max", "custom"
    min_value: 1
    max_type: custom
    max_value: 5
```

## Pivot table (`display: pivot`)

| Setting                          | Type    | Description                                                     |
| -------------------------------- | ------- | --------------------------------------------------------------- |
| `pivot_table.column_split`       | object  | `{ rows: [...names], columns: [...names], values: [...names] }` |
| `pivot_table.collapsed_rows`     | object  | `{ rows: [...collapsed_keys], value: [] }`                      |
| `pivot_table.show_row_totals`    | boolean |                                                                 |
| `pivot_table.show_column_totals` | boolean |                                                                 |

## Sankey (`display: sankey`)

| Setting                   | Type    | Values                                       |
| ------------------------- | ------- | -------------------------------------------- |
| `sankey.source`           | string  | Source column                                |
| `sankey.target`           | string  | Target column                                |
| `sankey.value`            | string  | Value column                                 |
| `sankey.node_align`       | string  | `"left"`, `"right"`, `"center"`, `"justify"` |
| `sankey.show_edge_labels` | boolean |                                              |

## Column settings

`column_settings` is keyed by a JSON-encoded column reference. Prefer the
`["name", "<output column name>"]` form — it is the canonical key Metabase writes and
is identical across forms. The `["ref", ["field", <id>, <opts>]]` form uses the
**legacy** field-ref order (id second); in the API form `<id>` is the numeric field id.

Per-column keys (apply under any column key):

| Key                 | Type        | Values                                                 |
| ------------------- | ----------- | ------------------------------------------------------ |
| `column_title`      | string      | Override the column header                             |
| `number_style`      | string      | `"decimal"`, `"currency"`, `"percent"`, `"scientific"` |
| `currency`          | string      | ISO code, e.g. `"USD"`                                 |
| `currency_style`    | string      | `"symbol"`, `"code"`, `"name"`                         |
| `number_separators` | string      | e.g. `".,"` (decimal + thousands)                      |
| `decimals`          | number      | Fixed decimal places                                   |
| `scale`             | number      | Multiply values by this factor                         |
| `prefix` / `suffix` | string      | Affixes around the value                               |
| `date_style`        | string      | moment.js format, e.g. `"MMMM D, YYYY"`                |
| `date_separator`    | string      | e.g. `"/"`                                             |
| `date_abbreviate`   | boolean     |                                                        |
| `time_enabled`      | string/null | `null`, `"minutes"`, `"seconds"`, `"milliseconds"`     |
| `time_style`        | string      | e.g. `"HH:mm"`, `"h:mm A"`                             |
| `view_as`           | string      | `"link"`, `"image"`, `"email"`, `"auto"`               |
| `link_text`         | string      | Display text when `view_as: link`                      |
| `link_url`          | string      | URL template; `{{value}}` interpolates the cell value  |
| `click_behavior`    | object      | Per-column click behavior (see below)                  |

```yaml
column_settings:
  '["name","TOTAL"]':
    number_style: currency
    currency: USD
    currency_style: symbol
    decimals: 2
    column_title: "Total Revenue"
  '["name","CREATED_AT"]':
    date_style: "MMMM D, YYYY"
    time_enabled: null
  '["name","EMAIL"]':
    view_as: link
    link_text: "Send email"
    link_url: "mailto:{{value}}"
```

## Virtual card settings (dashcards only, `card_id: null`)

| `virtual_card.display` | Extra keys                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `heading`              | `text` (the heading string)                                                                                       |
| `text`                 | `text` (markdown; `{{param}}` placeholders wired via dashcard `parameter_mappings`, target `[text-tag, name]`)    |
| `link`                 | `link.url`, or `link.entity` `{ id, model }` where model ∈ `question`/`dashboard`/`collection`/`database`/`table` |
| `iframe`               | `iframe` (the `<iframe …>` HTML string)                                                                           |
| `placeholder`          | —                                                                                                                 |

```yaml
visualization_settings:
  virtual_card:
    display: text
  text: "**Bold** and _italic_ markdown content"
```

## Click behavior

Stored at `visualization_settings.click_behavior` (whole dashcard) or per column at
`column_settings[<key>].click_behavior`.

| `type`        | Description                                  |
| ------------- | -------------------------------------------- |
| `actionMenu`  | Default drill-through menu (no config)       |
| `crossfilter` | Filter the dashboard using the clicked value |
| `link`        | Navigate to a URL, question, or dashboard    |

```yaml
# Link to URL — {{column}} = clicked row value, {{filter:param}} = dashboard parameter
click_behavior:
  type: link
  linkType: url
  linkTemplate: "https://example.com/orders/{{ORDER_ID}}?status={{filter:status}}"
  linkTextTemplate: "View Order {{ORDER_ID}}"

# Link to another dashboard/question — targetId is the entity_id of the target
click_behavior:
  type: link
  linkType: dashboard            # or "question"
  targetId: Q_jD-f-9clKLFZ2TfUG2h
  parameterMapping:
    target-param-uuid:
      id: target-param-uuid
      source: { id: USER_ID, name: User ID, type: column }
      target: { id: target-param-uuid, type: parameter }

# Crossfilter — map a clicked column to dashboard parameters
click_behavior:
  type: crossfilter
  parameterMapping:
    param-uuid:
      id: param-uuid
      source: { id: CATEGORY, name: Category, type: column }
      target: { id: param-uuid, type: parameter }
```

`parameterMapping` entries: `source` is where the value comes from
(`{ id, name, type }`, type `"column"`/`"parameter"`); `target` is where it goes
(`{ id, type }`, type `"parameter"`/`"dimension"`/`"variable"`). A `dimension` target
carries a `dimension` array — the same target shape as a dashboard parameter mapping.
