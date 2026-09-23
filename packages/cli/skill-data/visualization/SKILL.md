---
name: visualization
description: Choose a card's `display` (chart type) and write its `visualization_settings` in the card's YAML file - which chart fits which data shape, the binding keys each chart needs, the rule that settings name output columns, and the quoted-string `column_settings` keys. Points to the spec's Visualization Settings section for the full key catalog. Triggers - "what chart should I use", "make this a bar/line/pie chart", "map this by state", "format this column as currency", "add conditional formatting", "the card renders as a table instead of a chart", or any `display` / `visualization_settings` edit.
allowed-tools: Read, Write, Edit, Bash
---

# Visualization

A card file has two presentation fields next to its `dataset_query`:

- **`display`**: the chart type. The card schema limits it to a fixed list, so `mb check` rejects a typo like `bargraph`.
- **`visualization_settings`**: a map of keys named by chart family (`graph.*`, `pie.*`, `table.*`, ...). The schema accepts any map. Metabase ignores a misspelled key or a key for another `display`, and `mb check` does not warn you.

Pick the `display` first. Then bind the output columns and set options. Build the query itself with `mbql` or `native-sql`.

The full key catalog is the spec's Visualization Settings section. Find it with `grep -n '^### ' "$DIR/spec/spec.md"` (see `representations` for `$DIR`). Read only the subsection for your chart.

## Pick the `display` from the data's shape

- **One headline number**: `scalar`. Use `smartscalar` to show the change against the previous period. Use `gauge` or `progress` to show one value against a target.
- **A measure across categories**: `bar`. Use `row` (horizontal bars) for long or many labels. Sort by value unless the categories have a natural order.
- **A trend over time**: `line` for a continuous series. Use `bar` or `area` for a few discrete periods. Use `combo` (lines and bars on two axes) only for related measures on different scales.
- **Parts of a whole**: `pie`, only for 5 or fewer slices. Above 5, use a sorted `bar` or `row`. For composition over time, use a stacked `area` or `bar`.
- **A distribution**: a `bar` histogram over a binned column (see `mbql` binning). Use `boxplot` to compare the spread of several groups.
- **Correlation of two measures**: `scatter`.
- **Additive steps from a start to a total**: `waterfall`.
- **Drop-off through ordered stages**: `funnel`.
- **Flow between nodes**: `sankey`.
- **Geography**: `map`, as a region map, pins, or a grid.
- **Exact values, many columns, or no chart fits**: `table`. Use `pivot` for a cross-tab and `object` for one record.

Use `scalar` for a single number, not `number`. Don't give a card `heading`, `text`, `link`, `iframe`, `action`, or `list`. The first five are dashboard virtual cards (see `dashboard`).

## Settings name output columns

Every column-binding key takes the name of a column that the query produces:

- A breakout on a field produces the field's name, such as `CATEGORY` or `CREATED_AT`.
- `count` produces `count`, `sum` produces `sum`, and `avg` produces `avg`.
- An aggregation with a `name` option produces that name. Set `name` on aggregations you bind to.

Never put a field ref or a numeric id in a binding key.

## Bind the columns each chart needs

`visualization_settings: {}` is valid. For a simple aggregate, Metabase picks the columns. Set these keys to pin the choice, or when the chart falls back to a column picker.

| `display`                             | Data shape                                  | Binding keys                                                                                 |
| ------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `scalar`                              | 1 row                                       | `scalar.field` (when the result has more than 1 column)                                      |
| `smartscalar`                         | one measure by one time breakout            | `scalar.field`, optional `scalar.comparisons`                                                |
| `gauge`, `progress`                   | 1 row, 1 number                             | `gauge.segments`; `progress.goal`                                                            |
| `bar`, `line`, `area`, `combo`, `row` | 1 or 2 dimensions, 1 or more measures       | `graph.dimensions`, `graph.metrics`                                                          |
| `scatter`                             | 2 numeric columns                           | `graph.dimensions`, `graph.metrics`                                                          |
| `waterfall`                           | 1 dimension, 1 measure                      | `graph.dimensions`, `graph.metrics`                                                          |
| `boxplot`                             | unaggregated rows, 2 dimensions, 1 measure  | `graph.dimensions`, `graph.metrics`                                                          |
| `pie`                                 | 1 dimension, 1 measure                      | `pie.dimension`, `pie.metric`                                                                |
| `funnel`                              | stage and value                             | `funnel.dimension`, `funnel.metric`                                                          |
| `map` (region)                        | region column and measure                   | `map.type: region`, `map.region`, `map.dimension`, `map.metric`                              |
| `map` (pin, grid)                     | latitude and longitude                      | `map.type`, `map.latitude_column`, `map.longitude_column`, plus `map.metric_column` for grid |
| `sankey`                              | source, target, value                       | `sankey.source`, `sankey.target`, `sankey.value`                                             |
| `pivot`                               | 2 or more breakouts, 1 or more aggregations | `pivot_table.column_split`                                                                   |
| `table`, `object`                     | anything                                    | none                                                                                         |

`graph.dimensions` and `graph.metrics` are lists. The first dimension is the x-axis. A second dimension splits the measure into series. `bar`, `line`, `area`, and `combo` share one key set, so you can switch among them without other changes.

```yaml
display: bar
visualization_settings:
  "graph.dimensions": [CREATED_AT, CATEGORY]
  "graph.metrics": [count]
  "stackable.stack_type": stacked # or normalized (100%); omit for side by side
  "graph.x_axis.title_text": Quarter
```

```yaml
display: pie
visualization_settings:
  "pie.dimension": CATEGORY
  "pie.metric": count
```

```yaml
display: map
visualization_settings:
  "map.type": region
  "map.region": us_states
  "map.dimension": STATE
  "map.metric": count
```

## `column_settings` keys are quoted JSON strings

`column_settings` formats one column at a time. Each key is the string `["name","<output column>"]`. Wrap the key in single quotes so YAML reads it as a string:

```yaml
visualization_settings:
  column_settings:
    '["name","TOTAL"]':
      number_style: currency # decimal, percent, scientific, currency
      currency: USD
      decimals: 2
      column_title: Revenue
    '["name","CREATED_AT"]':
      date_style: "MMMM D, YYYY"
    '["name","EMAIL"]':
      view_as: link
      link_url: "mailto:{{value}}"
```

The spec's Column Settings section lists every formatting key.

## Find other options in the spec

| Need                                                                    | Spec subsection                                         |
| ----------------------------------------------------------------------- | ------------------------------------------------------- |
| Axis titles, scales, goal line, trend line, data labels, stacking       | Graph Settings                                          |
| Per-series color, line style, right axis, per-series display on `combo` | Series Settings                                         |
| Column order and visibility, conditional cell colors                    | Table Settings, Conditional Formatting                  |
| Pivot rows, columns, values, totals                                     | Pivot Table Settings                                    |
| Legend, center total, slice colors                                      | Pie Chart Settings                                      |
| Previous-period and target comparisons                                  | Smart Scalar Settings                                   |
| Gauge bands, funnel, waterfall, sankey, boxplot, map options            | the matching subsection                                 |
| Heading, text, and link cards; click behavior                           | Virtual Card Settings, Click Behavior (see `dashboard`) |

The repo's existing cards are working examples. Copy the `visualization_settings` of a card with the same `display`, then change the column names.

## Don't

- Don't put numeric field ids or field refs in binding keys. Write output column names.
- Don't write a `column_settings` key without quotes. It is the string `'["name","COL"]'`.
- Don't use a `pie` for more than 5 slices, or a `pie` or `scalar` to show a trend.
- Don't use `combo` for unrelated measures.
- Don't put `click_behavior` in a card file. It belongs on a dashcard.
- Don't trust a passing `mb check` for settings. It validates `display`, not `visualization_settings` keys.
