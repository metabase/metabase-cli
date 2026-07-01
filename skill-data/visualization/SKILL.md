---
name: visualization
description: Choose a card's `display` (chart type) and author its `visualization_settings` for the `mb` CLI — which chart fits which data shape, the required keys per chart, the rule that settings name OUTPUT columns, and the `column_settings` JSON-string-key footgun; the full per-chart key catalog is in references. Use when deciding or fixing how a card renders — "what chart should I use", "make this a bar/line/pie chart", "map this by state", "format this column as currency", "add conditional formatting", "the card renders as a table instead of a chart", or any `display` / `visualization_settings` work.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

# Visualization: pick the chart, then set it

> **Building charts as part of a guided data project?** Follow the `data-workflow` **Shared Contract** — answer-first with detail on demand, ask before showing PII, honor the autonomy mode, name what the CLI can't do instead of erroring into raw SQL: `mb skills get data-workflow`.

A card has two presentation fields alongside its `dataset_query`:

- **`display`** — the chart type (`bar`, `line`, `pie`, `scalar`, `map`, `table`, …); pick from the valid values below.
- **`visualization_settings`** — a map whose keys are **namespaced by `display`** (`graph.*` for bar/line/area/combo, `pie.*` for pie, `table.*` for table, …). The server stores almost anything and **silently ignores keys that don't apply** to the chosen `display`.

Nothing validates `visualization_settings` — there is no pre-flight to fail past. A `display` typo or a misnamed key is accepted by the API; the card just renders as a default table or drops the setting. So **the feedback loop is read-back, not pre-flight**: after `card create`/`update`, confirm with `mb card get <id> --full --json` (or open the card) that it rendered as intended.

Flag conventions and body-input precedence live in `core` (`mb skills get core`); the `dataset_query` itself is the `mbql` skill's job (`mb skills get mbql`). This skill is only about how the result is displayed.

Two steps: **(1) pick the `display` that fits the data**, then **(2) bind the data columns and set options**.

## Step 1 — pick the `display` for your data

Decide which relationship in the data matters most, then pick the chart. The shape each one needs is in the per-display table further down.

- **Single headline number** → `scalar` (one KPI). `smartscalar` when the story is the change vs the previous period. `gauge`/`progress` for one value against a target/goal.
- **Compare a measure across categories** → `bar` (vertical). Use `row` (horizontal bar) when labels are long or there are many categories. Sort by value unless the dimension has a natural order.
- **Change over time / trend** → `line` for a continuous series; `bar`/`area` for a few discrete periods. Two measures on unlike scales → `combo` (line + bar, dual-axis) — only when the metrics are genuinely related.
- **Part-to-whole, one snapshot** → `pie`, but only for a meaningful whole with **≤5 slices**; beyond that use a sorted `bar`/`row`. Composition over time → stacked `area`/`bar`.
- **Distribution / spread / outliers** → `boxplot` (especially comparing several groups).
- **Correlation between two measures** → `scatter` (a third measure → bubble size).
- **Sequential additive contributions** (start → +/− steps → total) → `waterfall`.
- **Stage drop-off in an ordered, cumulative funnel** → `funnel`.
- **Flow volume between nodes** (source → target + weight) → `sankey`.
- **Geographic** → `map`: region/choropleth (a region dimension + a measure), pin (lat + long), or grid/heat (coordinates + measure).
- **Precise values, many columns, mixed types, or no chart fits** → `table`; `pivot` for a cross-tab of two dimensions; `object` for a single record's detail.

Valid `display` values — the registered visualizations: `table`, `bar`, `line`, `area`, `row`, `pie`, `scalar`, `smartscalar`, `combo`, `pivot`, `funnel`, `map`, `scatter`, `waterfall`, `progress`, `gauge`, `object`, `sankey`, `boxplot`. The API types `display` as a plain string and accepts any value — it renders an unknown one as nothing. (`scalar` **is** the "Number" viz — `display: number` is a legacy serialization alias, not a registered visualization; use `scalar`. `list` exists but is hidden — don't pick it. `heading`/`text`/`link`/`iframe`/`action` are dashcard virtuals, not standalone cards — see references.) A typo like `bargraph`/`linechart` is accepted and renders blank — the most common "why is my chart blank" cause.

## Step 2 — bind data columns and set options

### Which chart for which data, and what to set

**Use for** is the data shape each chart suits. **Required** is the minimum to set for it to render as a chart — omit it and the card falls back to a "which columns?" prompt. Everything else is optional (full keys in references). **Empty `"visualization_settings": {}` is valid**: for a simple aggregate the binding is auto-picked, so set keys only to pin or override.

| `display`                   | Use for                                                   | Required                                                   |
| --------------------------- | --------------------------------------------------------- | ---------------------------------------------------------- |
| `scalar`                    | 1 row, 1 column                                           | — (`scalar.field` only if >1 column)                       |
| `smartscalar`               | one value grouped by a single **time** field              | — (needs a time breakout; `scalar.field` auto)             |
| `gauge`                     | 1 row, 1 numeric column                                   | — (`gauge.segments` auto)                                  |
| `progress`                  | 1 row, ≥1 numeric column                                  | — (`progress.goal` defaults to 0)                          |
| `bar` `line` `area` `combo` | >1 row, ≥2 cols, ≥1 dimension + ≥1 measure                | `graph.dimensions`, `graph.metrics`                        |
| `row`                       | as bar; prefer for long/many category labels              | `graph.dimensions`, `graph.metrics`                        |
| `scatter`                   | two numeric measures (correlation)                        | `graph.dimensions`, `graph.metrics` (`scatter.bubble` opt) |
| `waterfall`                 | exactly 1 dimension + ≥1 measure; sequential              | `graph.dimensions` (1), `graph.metrics` (1)                |
| `boxplot`                   | ≥3 cols, ≥2 dimensions, ≥1 measure                        | `graph.dimensions`, `graph.metrics`                        |
| `pie`                       | ≥2 rows, ≥2 cols, ≥1 dimension + ≥1 measure; ≤~5 slices   | `pie.dimension`, `pie.metric`                              |
| `funnel`                    | 2 columns (stage + value); ordered stages                 | `funnel.dimension`, `funnel.metric`                        |
| `map` (region)              | a string/region dimension + a measure                     | `map.region`, `map.dimension`, `map.metric`                |
| `map` (pin/grid)            | latitude + longitude columns                              | `map.latitude_column`, `map.longitude_column`              |
| `sankey`                    | ≥3 cols, ≥2 non-date dimensions, ≥1 measure; acyclic flow | `sankey.source`, `sankey.target`, `sankey.value`           |
| `pivot`                     | ≥2 cols, all aggregated/breakout                          | — (`pivot_table.column_split` auto)                        |
| `table` `object`            | anything (table is the universal fallback)                | — (always renders)                                         |

### The rule that trips everyone: settings name **output columns**, by name

`graph.dimensions`, `graph.metrics`, `pie.dimension`, `pie.metric`, `scalar.field`, `funnel.metric`, `map.latitude_column`, `sankey.source`, … all take **output column-name strings** — the names the query _produces_, not field ids. A `count` aggregation outputs the column `count`; a breakout on a field outputs that field's name; a named aggregation outputs its `name`. These strings are **identical in the API form and the portable (git-sync) form** — no numeric-vs-name footgun here.

The names come from the query's output, not from `mb field`/`mb table`. If you set `name` on an aggregation (see the `mbql` skill), use that same string here.

## Minimum-viable settings per chart family (API form)

Each block is the `visualization_settings` to pair with the given `display`. The `dataset_query` is elided — build it per the `mbql` skill. Output columns (`CATEGORY`, `count`, …) are whatever the query's breakout/aggregation produce.

**Bar / line / area / combo** — one dimension on the x-axis, one or more metrics (the four share an identical key set; switch `display` freely):

```json
"display": "bar",
"visualization_settings": { "graph.dimensions": ["CATEGORY"], "graph.metrics": ["count"] }
```

(Multiple metrics: `"graph.metrics": ["count","sum"]`. Stacked: add `"stackable.stack_type": "stacked"` — or `"normalized"` for 100%. A second dimension in `graph.dimensions` becomes a series breakout.)

**Row** — same keys; axes are visually swapped (horizontal bars).

**Pie** — one dimension, one metric:

```json
"display": "pie",
"visualization_settings": { "pie.dimension": "CATEGORY", "pie.metric": "count" }
```

**Scalar** (single big number) — the field to surface (only needed if >1 column):

```json
"display": "scalar",
"visualization_settings": { "scalar.field": "count" }
```

**Map (region/choropleth)** — region map + dimension + metric:

```json
"display": "map",
"visualization_settings": { "map.type": "region", "map.region": "us_states", "map.dimension": "STATE", "map.metric": "count" }
```

**Table** — column order/visibility plus per-column formatting:

```json
"display": "table",
"visualization_settings": {
  "table.columns": [ { "name": "CATEGORY", "enabled": true }, { "name": "count", "enabled": true } ],
  "column_settings": { "[\"name\",\"count\"]": { "column_title": "Orders" } }
}
```

## `column_settings`: the JSON-string-key footgun

`column_settings` is a map **whose keys are themselves JSON-encoded arrays** — so inside a JSON body the inner quotes must be escaped. The key is a _string_, never an object.

- **Prefer the name form:** `["name", "<output column name>"]` → in a JSON body, `"[\"name\",\"count\"]"`. This is the canonical key Metabase writes, and it's **identical in API and portable form**. Use it unless you have a reason not to.
- **Ref form (legacy order!):** `["ref", ["field", <id>, <opts>]]`. The inner field ref uses the **legacy MBQL-4 order** `["field", id, options]` (id **second**) — _not_ the MBQL-5 order you use in `dataset_query`. In the API form `<id>` is the numeric field id. Because the order differs, this form is easy to get wrong — reach for the name form instead.

```json
"column_settings": {
  "[\"name\",\"TOTAL\"]": { "number_style": "currency", "currency": "USD", "decimals": 2 },
  "[\"name\",\"CREATED_AT\"]": { "date_style": "MMMM D, YYYY" }
}
```

The exhaustive per-column key list (number/date formatting, `view_as`, alignment, mini bars, click behavior) is in the references file.

## Escape hatch: pull a real card instead of authoring from scratch

For anything beyond a single dimension + metric — combo charts, conditional formatting, pivot splits, click behavior, series colors — the cheapest **correct** path is to build it once in the Metabase UI and copy the result:

```bash
mb card get <id> --full --json | jq '.visualization_settings'
```

Paste that block into your `card create`/`update` body. The server produced it, so it's valid for that `display`.

## Full per-visualization key catalog

The body above covers the high-frequency 90%. The complete per-chart key tables — every key with its values and defaults, the data shape each chart suits, the full `column_settings` and `series_settings` vocabularies, conditional formatting, pivot splits, virtual cards (heading/text/link/iframe), and click behavior — live in the references file. Load on demand, not by default:

```bash
mb skills get visualization --full     # appends references/settings.md to this body
mb skills path visualization           # → the skill dir; then Read references/settings.md
```

## Don't

- Don't invent `display` values (`bargraph`, `linechart`, `histogram`) or use `number`/`list` — use a registered value; the API accepts a typo and renders nothing.
- Don't put numeric field ids in `graph.dimensions`/`pie.metric`/`scalar.field`/`map.latitude_column` etc. — they take **output column-name strings**.
- Don't reach for a `pie` with >5 slices, a `combo` of unrelated metrics, or a `pie`/`scalar` to show a trend — see Step 1.
- Don't write a `column_settings` key as an object — it's a JSON **string** (`"[\"name\",\"COL\"]"`), inner quotes escaped.
- Don't use the MBQL-5 field-ref order inside a `column_settings` `["ref", …]` key — that key uses the **legacy** `["field", id, opts]` order. Prefer the `["name", …]` form.
- Don't expect a pre-flight to catch viz mistakes — there is none. Verify by reading the card back.
- Don't hand-author complex charts when you can pull a working `visualization_settings` from a UI-built card.
