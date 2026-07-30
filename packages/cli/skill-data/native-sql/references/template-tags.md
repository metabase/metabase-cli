# Template tags — full reference

Every template-tag body, the widget-type vocabulary, and the parameter-object shapes. The main skill covers the two you author most (field filter, raw variable); this is the rest plus the exhaustive field lists.

## Template-tag bodies by `type`

The `template-tags` value is a map keyed by tag name; each entry's `name` must equal its key and the `{{name}}` in the SQL. `id` is a UUID — mint with `mb uuid`.

### Raw variable — `text` / `number` / `date` / `boolean`

```json
"min_total": {
  "id": "<uuid>",
  "name": "min_total",
  "display-name": "Minimum total",
  "type": "number",
  "required": false,
  "default": "50"
}
```

| Field          | Req | Notes                                        |
| -------------- | --- | -------------------------------------------- |
| `name`         | ✓   | equals map key and `{{name}}`                |
| `display-name` | ✓   | label shown in the widget                    |
| `type`         | ✓   | `text` \| `number` \| `date` \| `boolean`    |
| `id`           | —   | UUID; supply one                             |
| `required`     | —   | `true` blocks the run until a value is given |
| `default`      | —   | value used when none passed (string form)    |

SQL: `{{min_total}}`, spliced literally — you write the operator (`total > {{min_total}}`).

### Field filter — `dimension`

```json
"status": {
  "id": "<uuid>",
  "name": "status",
  "display-name": "Status",
  "type": "dimension",
  "dimension": ["field", {}, 141],
  "widget-type": "string/=",
  "default": null,
  "options": null,
  "alias": null
}
```

| Field         | Req | Notes                                                                                                                                                  |
| ------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `type`        | ✓   | `"dimension"`                                                                                                                                          |
| `dimension`   | ✓   | field ref `["field", {}, <id>]` — options object second, id third (the `mbql` rule); the legacy `["field", <id>, null]` form is rejected by pre-flight |
| `widget-type` | ✓   | the widget/operator; must suit the column type (table below)                                                                                           |
| `default`     | —   | e.g. a value, or a `["2024-01-01","2024-12-31"]` range                                                                                                 |
| `options`     | —   | filter options map (e.g. case sensitivity), usually `null`                                                                                             |
| `alias`       | —   | set when the column comes from an aliased table in the SQL                                                                                             |

SQL: bare — `WHERE {{status}}`. Never `WHERE status = {{status}}`. On write, send `{}` for the ref's options; the server fills a `lib/uuid` and the card reads back `["field", {"lib/uuid": "…"}, <id>]`.

### Snippet — `snippet`

```json
"snippet: Active Rows": {
  "id": "<uuid>",
  "name": "snippet: Active Rows",
  "display-name": "Snippet: Active Rows",
  "type": "snippet",
  "snippet-name": "Active Rows",
  "snippet-id": 5
}
```

SQL: `{{snippet: Active Rows}}`. Create/manage the fragment with `mb snippet` (`content` is bare SQL). No user value.

### Card reference — `card`

```json
"#42": {
  "id": "<uuid>",
  "name": "#42",
  "display-name": "#42",
  "type": "card",
  "card-id": 42
}
```

SQL: `{{#42}}` or `{{#42-slug}}`, used where a table/subquery goes (`FROM {{#42}}`, `WITH x AS {{#42}}`). Runs with the referenced card's own defaults; no user value.

### Source table — `table` (v59+)

A niche v59+ type that references a warehouse table by id (`{type: "table", table-id: <id>}`, optional `source-filters`) where a table/subquery goes — analogous to a card reference but pointing at a raw table. Absent on v0.58. Reach for a card reference (`card`) unless you specifically need a bare-table source tag.

### Temporal unit — `temporal-unit`

A widget that lets the viewer pick the time bucket (day/week/month/…) for a datetime column. Body mirrors a field filter (`dimension` legacy ref, optional `alias`) with `type: "temporal-unit"`.

## `widget-type` by column type

Closed enum — same vocabulary as a dashboard parameter `type`. Pick one whose family matches the bound column.

| Column type                            | Common widget-types                                                                                                   |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Text / string                          | `string/=` `string/!=` `string/contains` `string/does-not-contain` `string/starts-with` `string/ends-with` `category` |
| Number                                 | `number/=` `number/!=` `number/between` `number/>=` `number/<=`                                                       |
| Date / datetime                        | `date/all-options` `date/single` `date/range` `date/relative` `date/month-year` `date/quarter-year`                   |
| Boolean                                | `boolean/=`                                                                                                           |
| ID / FK                                | `id`                                                                                                                  |
| Location (with matching semantic type) | `location/city` `location/state` `location/zip_code` `location/country`                                               |

`date/all-options` gives the fullest date picker (single, range, relative). `category` yields a value-list dropdown for a low-cardinality text column.

## Parameter object — declared vs. runtime

Same object, two contexts. `target` links the parameter to a template tag: `["dimension", ["template-tag", "<name>"]]` for a field filter, `["variable", ["template-tag", "<name>"]]` for a raw variable.

**Declared** — in the card's `parameters` array, to set a default or a dropdown source:

```json
{
  "id": "<uuid>",
  "name": "status",
  "slug": "status",
  "type": "string/=",
  "target": ["dimension", ["template-tag", "status"]],
  "default": "active",
  "values_source_type": "static-list",
  "values_source_config": { "values": ["active", "churned", "trial"] }
}
```

`values_source_type`: omit to pull live distinct values from the bound field; `"static-list"` + `values_source_config.values` for a fixed list; `"card"` + `{card_id, value_field, label_field}` to source from a query.

**Runtime** — passed to `card query --parameters`; carries a `value`, no source config:

```json
{ "type": "string/=", "target": ["dimension", ["template-tag", "status"]], "value": "active" }
```

The runtime `type` is the value's type, not the tag's. Date ranges pass as `"value": ["2024-01-01", "2024-12-31"]`. Omit a parameter entirely to leave an optional (`[[ ]]`) clause out.

## Full native card body

What `mb card create --file` consumes:

```json
{
  "name": "Active orders by status",
  "display": "table",
  "visualization_settings": {},
  "dataset_query": {
    "lib/type": "mbql/query",
    "database": 1,
    "stages": [
      {
        "lib/type": "mbql.stage/native",
        "native": "SELECT status, count(*) FROM orders WHERE total > {{min_total}} [[AND {{status}}]] GROUP BY status",
        "template-tags": {
          "min_total": {
            "id": "<uuid>",
            "name": "min_total",
            "display-name": "Minimum total",
            "type": "number",
            "default": "0"
          },
          "status": {
            "id": "<uuid>",
            "name": "status",
            "display-name": "Status",
            "type": "dimension",
            "dimension": ["field", {}, 141],
            "widget-type": "string/="
          }
        }
      }
    ]
  }
}
```
