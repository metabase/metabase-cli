---
name: viz
description: Author Metabase `visualization_settings` and pick the right `display` for cards via the `mb` CLI. Covers the display → settings-namespace map (graph.*, pie.*, funnel.*, scalar.*, table.*, …), the column-name-vs-numeric-field-id rule, the `column_settings` JSON-string-key footgun, worked API-form examples per chart family, and the pull-from-UI escape hatch for complex charts. Load whenever shaping how a card renders by hand — "create a bar chart", "make this a line chart", "format this column as currency", "set the pie dimension and metric", "the card renders as a table instead of a chart", "add conditional formatting", or any `visualization_settings` work.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

# Visualization settings

A card has two presentation fields alongside its `dataset_query`:

- **`display`** — the chart type (`bar`, `line`, `pie`, `scalar`, `table`, …). One closed set of values; pick from the enum below.
- **`visualization_settings`** — a free-form map whose keys are **namespaced by `display`** (`graph.*` for bar/line, `pie.*` for pie, …). The server stores almost anything and **silently ignores keys that don't apply** to the chosen `display`.

The MBQL pre-flight does **not** validate `visualization_settings` — there is no `--skip-validate` to fail past, because nothing checks it. A `display` typo or a misnamed key is accepted by the API and the card just renders as a default table or drops the setting. So **the feedback loop is read-back, not pre-flight**: after `card create`/`update`, confirm with `mb card get <id> --full --json` (or open the card) that it rendered as intended.

The general flag conventions and body-input precedence live in the `core` skill (`mb skills get core`); the `dataset_query` body itself is the `mbql` skill's job (`mb skills get mbql`). This skill is only about how the result is displayed.

## `display` decides everything

`display` selects which setting namespace is read. Pick `display` first, then only the matching namespace's keys matter.

| `display`                                   | Settings namespace(s)                                     | Key columns are named by |
| ------------------------------------------- | --------------------------------------------------------- | ------------------------ |
| `bar` `line` `area` `combo` `row` `scatter` | `graph.*`, `series_settings`, `column_settings`           | output column **name**   |
| `waterfall`                                 | `graph.*` + `waterfall.*`                                 | output column name       |
| `boxplot`                                   | `graph.*` + `boxplot.*`                                   | output column name       |
| `pie`                                       | `pie.*`, `column_settings`                                | output column name       |
| `scalar` `number`                           | `scalar.*`                                                | output column name       |
| `smartscalar`                               | `scalar.comparisons`                                      | output column name       |
| `funnel`                                    | `funnel.*`                                                | output column name       |
| `gauge`                                     | `gauge.*`                                                 | —                        |
| `map`                                       | `map.*`                                                   | output column name       |
| `pivot`                                     | `pivot_table.*`, `table.*`                                | output column name       |
| `sankey`                                    | `sankey.*`                                                | output column name       |
| `table`                                     | `table.*`, `column_settings`                              | output column name       |
| `object` `list`                             | `column_settings`                                         | output column name       |
| `progress`                                  | `progress.goal`, `progress.color` (sparse — pull from UI) | —                        |
| `heading` `text` `link` `iframe` `action`   | dashcard-only `virtual_card` (see references)             | —                        |

Closed `display` enum (card-level): `table`, `bar`, `line`, `area`, `row`, `pie`, `scalar`, `smartscalar`, `number`, `combo`, `pivot`, `funnel`, `map`, `scatter`, `waterfall`, `progress`, `gauge`, `object`, `list`, `sankey`, `boxplot`. (`heading`/`text`/`link`/`iframe`/`action` are dashcard virtuals, not standalone cards.) An unknown value is accepted by the API but renders nothing useful — typos like `bargraph`/`linechart` are the most common cause of a "why is my chart blank" report.

## The rule that trips everyone: settings name **output columns**, by name

`graph.dimensions`, `graph.metrics`, `pie.dimension`, `pie.metric`, `scalar.field`, `funnel.metric`, `map.latitude_column`, … all take **output column-name strings** — the names the query _produces_, not field ids. A `count` aggregation outputs the column `count`; a breakout on a field outputs that field's name; a named aggregation outputs its `name`. These strings are **identical in the API form and the portable (git-sync) form** — no numeric-vs-name footgun here.

So the names you put in `visualization_settings` come from the query's output, not from `mb field`/`mb table`. If you set `name` on an aggregation (see the `mbql` skill, "Naming aggregation output columns"), use that same string here.

## Minimum-viable settings per chart family (API form)

Each example is the `visualization_settings` block to pair with the given `display` on a `card create`/`update` body. The `dataset_query` is elided — build it per the `mbql` skill. The output columns referenced (`CATEGORY`, `count`) are whatever the query's breakout/aggregation produce.

**Bar / line / area** — one dimension on the x-axis, one or more metrics:

```json
"display": "bar",
"visualization_settings": {
  "graph.dimensions": ["CATEGORY"],
  "graph.metrics": ["count"]
}
```

(Switch `display` to `line` or `area` with the same `graph.*` keys. Multiple metrics: `"graph.metrics": ["count", "sum"]`. Stacked: add `"stackable.stack_type": "stacked"`.)

**Pie** — one dimension, one metric:

```json
"display": "pie",
"visualization_settings": { "pie.dimension": "CATEGORY", "pie.metric": "count" }
```

**Scalar** (single big number) — the field to surface:

```json
"display": "scalar",
"visualization_settings": { "scalar.field": "count" }
```

**Table** — column order/visibility plus per-column formatting:

```json
"display": "table",
"visualization_settings": {
  "table.columns": [
    { "name": "CATEGORY", "enabled": true },
    { "name": "count", "enabled": true }
  ],
  "column_settings": {
    "[\"name\",\"count\"]": { "column_title": "Orders" }
  }
}
```

An **empty** `"visualization_settings": {}` is valid for any `display` — Metabase falls back to sensible defaults (it auto-picks dimensions/metrics for a simple aggregate). Set keys only to override the defaults.

## `column_settings`: the JSON-string-key footgun

`column_settings` is a map **whose keys are themselves JSON-encoded arrays** — so inside a JSON body the inner quotes must be escaped. The key is a _string_, never an object.

- **Prefer the name form:** `["name", "<output column name>"]` → in a JSON body, `"[\"name\",\"count\"]"`. This is the canonical key Metabase writes (`getColumnKey`), and it's **identical in API and portable form**. Use it unless you have a reason not to.
- **Ref form (legacy order!):** `["ref", ["field", <id>, <opts>]]`. The inner field ref here uses the **legacy MBQL-4 order** `["field", id, options]` (id **second**) — _not_ the MBQL-5 order `["field", {options}, id]` you use in `dataset_query`. In the API form `<id>` is the **numeric** field id; the portable form uses a name path. Because the order differs from MBQL 5, this form is easy to get wrong — reach for the name form instead.

```json
"column_settings": {
  "[\"name\",\"TOTAL\"]": { "number_style": "currency", "currency": "USD", "decimals": 2 },
  "[\"name\",\"CREATED_AT\"]": { "date_style": "MMMM D, YYYY" }
}
```

The exhaustive per-column key list (number/date/link formatting, `view_as`, click behavior) is in the references file.

## Escape hatch: pull a real card instead of authoring from scratch

For anything beyond a single dimension + metric — combo charts, conditional formatting, pivot splits, click behavior, series colors — the cheapest **correct** path is to build it once in the Metabase UI and copy the result:

```bash
mb card get <id> --full --json | jq '.visualization_settings'
```

Paste that block into your `card create`/`update` body. The server produced it, so it's guaranteed valid for that `display`. This beats guessing keys from memory, and it's token-cheap (no schema dump).

## Full key catalog

The body above covers the high-frequency 90%. The complete per-display key tables — every `graph.*`/`pie.*`/`table.*`/… key, series settings, conditional formatting rules, pivot splits, the full `column_settings` formatting vocabulary, virtual-card (heading/text/link/iframe) settings, and click behavior — live in this skill's references file. Load it on demand, not by default:

```bash
mb skills get viz --full          # appends references/settings.md to this body
mb skills path viz                # → the skill dir; then Read references/settings.md
```

## Don't

- Don't invent `display` values (`bargraph`, `linechart`, `histogram`) — use the closed enum; the API accepts the typo and renders nothing.
- Don't put numeric field ids in `graph.dimensions`/`pie.metric`/`scalar.field` etc. — they take **output column-name strings**.
- Don't write a `column_settings` key as an object — it's a JSON **string** (`"[\"name\",\"COL\"]"`), inner quotes escaped.
- Don't use the MBQL-5 field-ref order inside a `column_settings` `["ref", …]` key — that key uses the **legacy** `["field", id, opts]` order. Prefer the `["name", …]` form and sidestep it.
- Don't expect a pre-flight to catch viz mistakes — there is none. Verify by reading the card back.
- Don't hand-author complex charts when you can pull a working `visualization_settings` from a UI-built card.
