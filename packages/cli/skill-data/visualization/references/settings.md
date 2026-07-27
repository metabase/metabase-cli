# visualization_settings — per-chart key reference

## Contents

- [Cartesian — `bar`, `line`, `area`, `combo`, `scatter`, `waterfall`, `row`, `boxplot`](#cartesian--bar-line-area-combo-scatter-waterfall-row-boxplot) — shared keys (binding, stacking, goal/trend, data labels, axes, tooltip) plus `scatter`, `waterfall`, `row`, `boxplot` extras
- [Part-to-whole & single value — `pie`, `funnel`, `gauge`, `progress`, `scalar`, `smartscalar`](#part-to-whole--single-value--pie-funnel-gauge-progress-scalar-smartscalar)
- [Tabular, geographic & flow — `table`, `pivot`, `object`, `map`, `sankey`](#tabular-geographic--flow--table-pivot-object-map-sankey) — includes `table.column_formatting` conditional formatting
- [`column_settings` — per-column formatting](#column_settings--per-column-formatting) — number/date/currency, `view_as`, alignment, mini bars
- [`series_settings` — per-series styling (cartesian)](#series_settings--per-series-styling-cartesian)
- [Virtual cards (dashcards only, `card_id: null`)](#virtual-cards-dashcards-only-card_id-null) — heading/text/link/iframe
- [Click behavior (dashcards only)](#click-behavior-dashcards-only)

---

Authorable keys per `display`, plus the data shape each chart suits and the minimum needed to render. Set keys only to override defaults — an empty `{}` works for a simple aggregate.

All column-naming keys (`graph.dimensions`, `pie.dimension`, `table.columns[].name`, `map.latitude_column`, …) take **output column-name strings** — the names the query produces. Every key and value below is identical in the API form (`mb card create`) and the portable git-sync form, with two exceptions: `column_settings` `["ref", …]` keys and click-behavior dimension targets carry a numeric field id in the API form and a name-path in the portable form. In a JSON body, `column_settings` keys are escaped strings: `"[\"name\",\"TOTAL\"]"`.

---

# Cartesian — `bar`, `line`, `area`, `combo`, `scatter`, `waterfall`, `row`, `boxplot`

`bar`/`line`/`area`/`combo` share an identical key set (combo just defaults the first series to a line, the rest to bars). `scatter`/`waterfall`/`row`/`boxplot` use a subset plus their own extras. Most allow up to 2 dimensions and unlimited metrics; **waterfall is 1 dimension + 1 metric**, boxplot allows 2 dimensions.

## Shared keys

**Data binding**

| Key                  | Type                 | Notes                                                                               |
| -------------------- | -------------------- | ----------------------------------------------------------------------------------- |
| `graph.dimensions`   | string[] (col names) | X-axis. Index 0 = x-axis; a 2nd entry = series breakout.                            |
| `graph.metrics`      | string[] (col names) | Y-axis metric column(s).                                                            |
| `graph.series_order` | object[]             | Per-series order/visibility `{ key, name, color, enabled }` (only with a breakout). |

**Stacking**

| Key                    | Type           | Values                                           | Default                                        |
| ---------------------- | -------------- | ------------------------------------------------ | ---------------------------------------------- |
| `stackable.stack_type` | string \| null | `null`, `"stacked"`, `"normalized"` (100%)       | `null` (`"stacked"` for `area` with >1 series) |
| `graph.split_panels`   | boolean        | each series in its own panel (excludes stacking) | `false`                                        |

**Goal & trend**

| Key                    | Type    | Default  |
| ---------------------- | ------- | -------- |
| `graph.show_goal`      | boolean | `false`  |
| `graph.goal_value`     | number  | `0`      |
| `graph.goal_label`     | string  | `"Goal"` |
| `graph.show_trendline` | boolean | `false`  |

**Data labels**

| Key                            | Type    | Values                                             | Default   |
| ------------------------------ | ------- | -------------------------------------------------- | --------- |
| `graph.show_values`            | boolean |                                                    | `false`   |
| `graph.label_value_frequency`  | string  | `"fit"`, `"all"`                                   | `"fit"`   |
| `graph.show_stack_values`      | string  | `"total"`, `"series"`, `"all"` (stacked bars only) | `"total"` |
| `graph.label_value_formatting` | string  | `"auto"`, `"compact"`, `"full"`                    | `"auto"`  |

**Axes**

| Key                                                   | Type              | Values                                                                                           | Default     |
| ----------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------ | ----------- |
| `graph.x_axis.scale`                                  | string            | `"timeseries"`, `"linear"`, `"pow"`, `"log"`, `"histogram"`, `"ordinal"` (subset by column type) | auto        |
| `graph.y_axis.scale`                                  | string            | `"linear"`, `"pow"`, `"log"`                                                                     | `"linear"`  |
| `graph.x_axis.axis_enabled`                           | boolean \| string | `false`, `true`, `"compact"`, `"rotate-45"`, `"rotate-90"`                                       | `true`      |
| `graph.y_axis.axis_enabled`                           | boolean           |                                                                                                  | `true`      |
| `graph.y_axis.unpin_from_zero`                        | boolean           | don't force the Y axis through 0                                                                 | varies      |
| `graph.y_axis.auto_range`                             | boolean           |                                                                                                  | `true`      |
| `graph.y_axis.min` / `.max`                           | number            | when `auto_range` is `false`                                                                     | `0` / `100` |
| `graph.y_axis.auto_split`                             | boolean           | split Y axis for multi-series                                                                    | auto        |
| `graph.x_axis.title_text` / `graph.y_axis.title_text` | string            | axis label text (toggle with `*.labels_enabled`)                                                 | column name |

**Tooltip**

| Key                     | Type                 | Notes                        |
| ----------------------- | -------------------- | ---------------------------- |
| `graph.tooltip_columns` | string[] (col names) | extra columns shown on hover |

Per-series color/type/line-style live in `series_settings` (see below).

## bar / line / area / combo

Use for comparing a measure across categories (`bar`) or change over time (`line`/`area`); `combo` overlays a line and bars for two related measures on different scales. **Use for:** >1 row, ≥2 columns, ≥1 dimension + ≥1 measure. **Required:** `graph.dimensions`, `graph.metrics`. Stacked-100% (`normalized`) is incompatible with a `log` y-scale.

## scatter

Use for correlation between two numeric measures. Extra: `scatter.bubble` (numeric col name → bubble size). No stacking, data labels, or legend. **Required:** `graph.dimensions`, `graph.metrics`.

## waterfall

Use for sequential additive contributions (start → +/− steps → total). **Use for:** exactly 1 dimension + 1 measure. X-scale can't be `pow`/`log`.

| Key                        | Type    | Default |
| -------------------------- | ------- | ------- |
| `waterfall.increase_color` | string  | accent1 |
| `waterfall.decrease_color` | string  | accent3 |
| `waterfall.show_total`     | boolean | `true`  |
| `waterfall.total_color`    | string  | theme   |

## row

Horizontal bars — use when category labels are long or numerous. Here `graph.dimensions` is the y-axis (categories) and `graph.metrics` the x-axis (values). X-scale is `"ordinal"` only; no trend line, tooltip columns, or split panels. **Required:** `graph.dimensions`, `graph.metrics`.

## boxplot

_Registered only on **v59+** servers — older ones render `display: boxplot` blank; use a `bar` histogram there._

Use for distribution/spread/outliers, especially across several groups. Needs **unaggregated** rows. **Use for:** ≥3 columns, ≥2 dimensions, ≥1 measure. **Required:** `graph.dimensions`, `graph.metrics`. X-scale is `"ordinal"`.

| Key                        | Type    | Values                                         | Default      |
| -------------------------- | ------- | ---------------------------------------------- | ------------ |
| `boxplot.whisker_type`     | string  | `"tukey"` (1.5×IQR), `"min-max"`               | `"tukey"`    |
| `boxplot.points_mode`      | string  | `"none"`, `"outliers"`, `"all"`                | `"outliers"` |
| `boxplot.show_mean`        | boolean |                                                | `true`       |
| `boxplot.show_values_mode` | string  | `"median"`, `"all"` (when `graph.show_values`) | `"median"`   |

---

# Part-to-whole & single value — `pie`, `funnel`, `gauge`, `progress`, `scalar`, `smartscalar`

## pie

Use for part-to-whole, one snapshot, ≤5 slices. **Use for:** ≥2 rows, ≥2 columns, ≥1 dimension + ≥1 measure. **Required:** `pie.dimension`, `pie.metric`.

| Key                      | Type               | Values                                            | Default                |
| ------------------------ | ------------------ | ------------------------------------------------- | ---------------------- |
| `pie.metric`             | string (col name)  | the measure                                       | first metric           |
| `pie.dimension`          | string \| string[] | the dimension; array = concentric rings (up to 3) | first dimension        |
| `pie.show_legend`        | boolean            |                                                   | `true`                 |
| `pie.show_total`         | boolean            | total in the center                               | `true`                 |
| `pie.show_labels`        | boolean            | slice labels                                      | `true` if >1 dimension |
| `pie.percent_visibility` | string             | `"off"`, `"legend"`, `"inside"`, `"both"`         | `"legend"`             |
| `pie.decimal_places`     | number             | decimal places for percentages                    | auto                   |
| `pie.slice_threshold`    | number (percent)   | min slice % before grouping into "Other"          | `2.5`                  |

(Set slice colors via the UI/escape hatch.)

## funnel

Use for stage drop-off in an ordered, cumulative funnel. **Use for:** 2 columns (stage + value). **Required:** `funnel.dimension`, `funnel.metric`.

| Key                | Type              | Values                                     | Default                              |
| ------------------ | ----------------- | ------------------------------------------ | ------------------------------------ |
| `funnel.dimension` | string (col name) | the step column                            | first dimension                      |
| `funnel.metric`    | string (col name) | the step value                             | first metric                         |
| `funnel.type`      | string            | `"funnel"`, `"bar"`                        | `"funnel"` (`"bar"` if multi-series) |
| `funnel.rows`      | object[]          | step order/enable `{ key, name, enabled }` | data order                           |

## gauge

Use for one value against colored target ranges. **Use for:** 1 row, 1 numeric column.

| Key              | Type     | Notes                                                              |
| ---------------- | -------- | ------------------------------------------------------------------ |
| `gauge.segments` | object[] | value ranges `{ min, max, color?, label? }` (`min`/`max` required) |

## progress

Use for one value's progress toward a goal. **Use for:** 1 row, ≥1 numeric column.

| Key              | Type                       | Values                                | Default       |
| ---------------- | -------------------------- | ------------------------------------- | ------------- |
| `progress.value` | string (col name)          | the numeric column (only if >1)       | first numeric |
| `progress.goal`  | number **or** string (col) | a literal target, or a numeric column | `0`           |
| `progress.color` | string (color)             | bar color                             | accent1       |

## scalar

A single KPI — this **is** the "Number" viz (`display: scalar`). **Use for:** 1 row, 1 column. Number formatting (currency, decimals, prefix/suffix) is set per-column in `column_settings`, not here.

| Key               | Type              | Notes                                         | Default   |
| ----------------- | ----------------- | --------------------------------------------- | --------- |
| `scalar.field`    | string (col name) | which column to show (only if >1 column)      | first col |
| `scalar.segments` | object[]          | color thresholds `{ min, max, color, label }` | `[]`      |

## smartscalar

Use for a value's change vs the previous period. **Use for:** one value grouped by a single **time** field.

| Key                               | Type              | Default         |
| --------------------------------- | ----------------- | --------------- |
| `scalar.field`                    | string (col name) | first numeric   |
| `scalar.comparisons`              | object[]          | up to 3 (below) |
| `scalar.switch_positive_negative` | boolean           | `false`         |
| `scalar.compact_primary_number`   | boolean           | `false`         |

Each `scalar.comparisons` entry is `{ id, type, … }`:

| `type`             | Extra fields      | Meaning                |
| ------------------ | ----------------- | ---------------------- |
| `"previousPeriod"` | —                 | vs. the prior period   |
| `"previousValue"`  | —                 | vs. the previous value |
| `"periodsAgo"`     | `value`           | vs. N periods ago      |
| `"staticNumber"`   | `value`, `label`  | vs. a fixed number     |
| `"anotherColumn"`  | `column`, `label` | vs. another column     |

```yaml
scalar.comparisons:
  - { id: c1, type: previousPeriod }
  - { id: c2, type: periodsAgo, value: 12 }
  - { id: c3, type: staticNumber, value: 1000, label: Target }
```

---

# Tabular, geographic & flow — `table`, `pivot`, `object`, `map`, `sankey`

## table

The universal fallback; use for precise values, many columns, or mixed types. Always renders.

| Key                          | Type     | Notes                                                      | Default                                     |
| ---------------------------- | -------- | ---------------------------------------------------------- | ------------------------------------------- |
| `table.columns`              | object[] | column order + visibility `{ name, enabled }`              | all columns                                 |
| `table.column_formatting`    | object[] | conditional formatting rules (below)                       | `[]`                                        |
| `table.pivot`                | boolean  | simple in-table pivot (2 dims + 1 metric)                  | `true` only when 3 cols = 2 dims + 1 metric |
| `table.pivot_column`         | string   | dimension whose values become columns (when `table.pivot`) | auto                                        |
| `table.cell_column`          | string   | column supplying pivot cell values (when `table.pivot`)    | first metric                                |
| `table.pagination`           | boolean  |                                                            | `false`                                     |
| `table.row_index`            | boolean  | show a row-index column                                    | `false`                                     |
| `table.freeze_columns`       | boolean  | freeze leading columns                                     | `false`                                     |
| `table.freeze_columns_count` | number   | how many to freeze (when `freeze_columns`)                 | `1`                                         |
| `table.freeze_rows`          | boolean  | freeze leading rows                                        | `false`                                     |
| `table.freeze_rows_count`    | number   | how many to freeze (when `freeze_rows`)                    | `1`                                         |

Per-column titles, currency, links, alignment, and mini bars are set in `column_settings`.

**Conditional formatting (`table.column_formatting`)** — a list of rules, each `type: "single"` or `"range"`:

```yaml
table.column_formatting:
  - {
      columns: [Total],
      type: single,
      operator: ">",
      value: 100,
      color: "#84BB4C",
      highlight_row: false,
    }
  - {
      columns: [Rating],
      type: range,
      colors: ["#ED6E6E", "#F9CF48", "#84BB4C"],
      min_type: custom,
      min_value: 1,
      max_type: custom,
      max_value: 5,
    }
```

`single` operators: `"="`, `"!="`, `"<"`, `">"`, `"<="`, `">="`, `"is-null"`, `"not-null"`, `"contains"`, `"does-not-contain"`, `"starts-with"`, `"ends-with"`, `"is-true"`, `"is-false"`. `range` `min_type`/`max_type`: `"custom"`, `"all"`, or `null`.

## pivot

Use for a cross-tab of two dimensions. Needs an aggregated query built in the query builder (not native), on a database that supports pivots. The split and formatting use the `pivot_table.*` namespace; the totals toggles use `pivot.*`.

| Key                               | Type     | Notes                                                           | Default |
| --------------------------------- | -------- | --------------------------------------------------------------- | ------- |
| `pivot_table.column_split`        | object   | `{ rows: [...names], columns: [...names], values: [...names] }` | auto    |
| `pivot.show_row_totals`           | boolean  |                                                                 | `true`  |
| `pivot.show_column_totals`        | boolean  |                                                                 | `true`  |
| `pivot.condense_duplicate_totals` | boolean  | hide duplicate total cells                                      | `true`  |
| `pivot_table.column_formatting`   | object[] | conditional formatting on measure cells                         | —       |

Per-column (under `column_settings[<key>]`): `pivot_table.column_sort_order` (`"ascending"`/`"descending"`), `pivot_table.column_show_totals` (boolean).

## object

A single record's detail. `table.columns` (`{ name, enabled }`) picks which fields to show; per-column `column_settings` apply.

## map

Three modes via `map.type`. **Region** (`"region"`) colors predefined areas; **pin** (`"pin"`) plots lat/long points; **grid** (`"grid"`) bins points. **Required:** region → `map.region`, `map.dimension`, `map.metric`; pin/grid → `map.latitude_column`, `map.longitude_column`.

| Key                                                        | Type              | Values / notes                                              | Mode     |
| ---------------------------------------------------------- | ----------------- | ----------------------------------------------------------- | -------- |
| `map.type`                                                 | string            | `"region"`, `"pin"`, `"grid"`                               | all      |
| `map.region`                                               | string            | `"us_states"`, `"world_countries"`, or a custom-geojson key | region   |
| `map.dimension`                                            | string (col name) | the region column                                           | region   |
| `map.metric`                                               | string (col name) | metric coloring the regions                                 | region   |
| `map.colors`                                               | string[]          | region color scale                                          | region   |
| `map.latitude_column`                                      | string (col name) | latitude                                                    | pin/grid |
| `map.longitude_column`                                     | string (col name) | longitude                                                   | pin/grid |
| `map.metric_column`                                        | string (col name) | metric for heat/grid intensity                              | pin      |
| `map.pin_type`                                             | string            | `"tiles"`, `"markers"`, `"grid"`, `"heat"`                  | pin      |
| `map.heat.radius` / `.blur` / `.min-opacity` / `.max-zoom` | number            | heatmap tuning                                              | heat     |

## sankey

Use for flow volume between nodes. Needs distinct source and target columns forming an acyclic flow (≤150 unique nodes). **Use for:** ≥3 columns, ≥2 non-date dimensions, ≥1 measure. **Required:** `sankey.source`, `sankey.target`, `sankey.value`.

| Key                             | Type              | Values                           | Default    |
| ------------------------------- | ----------------- | -------------------------------- | ---------- |
| `sankey.source`                 | string (col name) | flow source                      | auto       |
| `sankey.target`                 | string (col name) | flow target                      | auto       |
| `sankey.value`                  | string (col name) | edge weight                      | auto       |
| `sankey.node_align`             | string            | `"left"`, `"right"`, `"justify"` | `"left"`   |
| `sankey.show_edge_labels`       | boolean           |                                  | `false`    |
| `sankey.label_value_formatting` | string            | `"auto"`, `"compact"`, `"full"`  | `"auto"`   |
| `sankey.edge_color`             | string            | `"gray"`, `"source"`, `"target"` | `"source"` |

---

# `column_settings` — per-column formatting

A map keyed by a JSON-encoded column reference, applying to `table`, `pie`, `object`, the cartesian charts, and more.

**Key forms:** prefer the name form `["name", "<output column name>"]` — it's what Metabase writes and is identical across API and portable forms. A legacy ref form `["ref", ["field", <id>, <opts>]]` exists for read-back; its inner field ref uses the **legacy order** (id second) with a numeric id in the API form — avoid it. In a JSON body the key is an escaped string: `"[\"name\",\"TOTAL\"]"`.

| Key                  | Type         | Values                                                       | Applies to      |
| -------------------- | ------------ | ------------------------------------------------------------ | --------------- |
| `column_title`       | string       | header override                                              | all             |
| `text_align`         | string       | `"left"`, `"right"`, `"middle"`                              | table           |
| `view_as`            | string\|null | `null` (text), `"link"`, `"email_link"`, `"image"`, `"auto"` | table           |
| `link_text`          | string       | text for a link/email_link (supports `{{COLUMN}}`)           | table           |
| `link_url`           | string       | target URL (supports `{{COLUMN}}`)                           | table           |
| `show_mini_bar`      | boolean      | inline bar in the cell                                       | number          |
| `text_wrapping`      | boolean      | wrap long text                                               | string          |
| `number_style`       | string       | `"decimal"`, `"currency"`, `"percent"`, `"scientific"`       | number          |
| `currency`           | string       | ISO code, e.g. `"USD"`                                       | currency        |
| `currency_style`     | string       | `"symbol"`, `"narrowSymbol"`, `"code"`, `"name"`             | currency        |
| `currency_in_header` | boolean      | show currency in the header vs every cell                    | currency, table |
| `number_separators`  | string       | `".,"`, `", "`, `",."`, `"."`, `".’"`                        | number          |
| `decimals`           | number       | fixed decimal places                                         | number          |
| `scale`              | number       | multiply the value by this factor                            | number          |
| `prefix` / `suffix`  | string       | affixes around the value                                     | number          |
| `date_style`         | string       | moment.js format, e.g. `"MMMM D, YYYY"`                      | date            |
| `date_separator`     | string       | `"/"`, `"-"`, `"."`                                          | date            |
| `date_abbreviate`    | boolean      | abbreviate day/month names                                   | date            |
| `time_enabled`       | string\|null | `null`, `"minutes"`, `"seconds"`, `"milliseconds"`           | date+time       |
| `time_style`         | string       | e.g. `"h:mm A"`, `"HH:mm"`                                   | date+time       |
| `click_behavior`     | object       | per-column click behavior — **dashcards only** (below)       | all             |

```yaml
column_settings:
  '["name","TOTAL"]':
    number_style: currency
    currency: USD
    decimals: 2
    column_title: "Total Revenue"
  '["name","CREATED_AT"]': { date_style: "MMMM D, YYYY", time_enabled: null }
  '["name","EMAIL"]': { view_as: email_link, link_text: "Email {{NAME}}" }
```

---

# `series_settings` — per-series styling (cartesian)

A map under `series_settings`, keyed by series name: the metric column's name for a single series, or the breakout value for a broken-out series.

| Key                     | Type          | Values                                               | Default         |
| ----------------------- | ------------- | ---------------------------------------------------- | --------------- |
| `title`                 | string        | series label                                         | column name     |
| `color`                 | string        | series color                                         | palette         |
| `display`               | string        | `"line"`, `"area"`, `"bar"` (per-series type, combo) | card default    |
| `line.interpolate`      | string        | `"linear"`, `"cardinal"` (curved), `"step-after"`    | `"linear"`      |
| `line.style`            | string        | `"solid"`, `"dashed"`, `"dotted"`                    | `"solid"`       |
| `line.size`             | string        | `"S"`, `"M"`, `"L"`                                  | `"M"`           |
| `line.marker_enabled`   | boolean\|null | `null` (auto), `true`, `false`                       | `null`          |
| `line.missing`          | string        | `"zero"`, `"none"`, `"interpolate"`                  | `"interpolate"` |
| `axis`                  | string\|null  | `null` (auto), `"left"`, `"right"`                   | `null`          |
| `show_series_values`    | boolean       | value labels for this series                         | inherits chart  |
| `show_series_trendline` | boolean       | trend line for this series                           | inherits chart  |

`line.*` keys apply only when the series `display` is `line`/`area`.

```yaml
series_settings:
  Revenue: { display: line, color: "#509EE3", axis: left, show_series_values: true }
```

---

# Virtual cards (dashcards only, `card_id: null`)

Text/heading/link/iframe tiles carry `visualization_settings.virtual_card.display`:

| `virtual_card.display` | Extra keys                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| `heading`              | `text` (the heading string)                                                                                    |
| `text`                 | `text` (markdown; `{{param}}` placeholders wired via dashcard `parameter_mappings`, target `[text-tag, name]`) |
| `link`                 | `link.url`, or `link.entity` `{ id, model }`, model ∈ `question`/`dashboard`/`collection`/`database`/`table`   |
| `iframe`               | `iframe` (the `<iframe …>` HTML string)                                                                        |

```yaml
visualization_settings:
  virtual_card: { display: text }
  text: "**Bold** and _italic_ markdown content"
```

---

# Click behavior (dashcards only)

Click behavior is a **dashboard** feature — author it in a **dashcard's** `visualization_settings` (whole-card) or its `column_settings[<key>].click_behavior` (per column), **not** in a saved card's own `visualization_settings`. There is no query-builder UI for it, and the interactive types need the dashboard around them: `crossfilter` reads the dashboard's parameters, and links to a `question`/`dashboard` resolve against the dashboard's target entities — both do nothing on a standalone card. (A bare URL link is the only type not strictly gated by dashboard context, but it's still only authored on dashcards.)

`type` is `actionMenu` (default drill-through menu), `crossfilter` (filter the dashboard with the clicked value), or `link` (go to a URL, question, or dashboard).

```yaml
# Link to a URL — {{column}} = clicked row value, {{filter:param}} = dashboard parameter
click_behavior:
  type: link
  linkType: url
  linkTemplate: "https://example.com/orders/{{ORDER_ID}}?status={{filter:status}}"

# Link to another dashboard/question — targetId is the target's entity_id
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

In `parameterMapping`, `source` is `{ id, name, type }` (type `"column"`/`"parameter"`) and `target` is `{ id, type }` (type `"parameter"`/`"dimension"`/`"variable"`); a `dimension` target also carries a `dimension` array.
