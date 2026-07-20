# Template tags — full reference

Every template-tag body, the widget-type vocabulary, and the parameter shapes. The main skill covers the two you author most (field filter, raw variable); this is the rest plus the exhaustive field lists.

## Template-tag bodies by `type`

`question_write`'s `native.template_tags` is a map keyed by tag name; each key is the `{{name}}` used in the SQL. `id` (a UUID) and `display-name` are minted from the key — supply them only to override, and supply `name` only when it must differ from the key. `type` is one of `text`, `number`, `date`, `boolean`, `dimension`, `snippet`, `card`.

### Raw variable — `text` / `number` / `date` / `boolean`

```json
"min_total": {
  "type": "number",
  "display-name": "Minimum total",
  "required": false,
  "default": "50"
}
```

| Field          | Req | Notes                                        |
| -------------- | --- | -------------------------------------------- |
| `type`         | ✓   | `text` \| `number` \| `date` \| `boolean`    |
| `display-name` | —   | label shown in the widget; minted from the key |
| `id`           | —   | UUID; minted from the key                    |
| `name`         | —   | defaults to the map key                      |
| `required`     | —   | `true` blocks the run until a value is given |
| `default`      | —   | value used when none passed (string form)    |

SQL: `{{min_total}}`, spliced literally — you write the operator (`total > {{min_total}}`).

### Field filter — `dimension`

```json
"status": {
  "type": "dimension",
  "dimension": ["field", {}, 141],
  "widget-type": "string/=",
  "default": null,
  "options": null,
  "alias": null
}
```

| Field         | Req | Notes                                                                                                                                     |
| ------------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `type`        | ✓   | `"dimension"`                                                                                                                             |
| `dimension`   | ✓   | field ref `["field", {}, <id>]` — options object second, id third (the `mbql` rule), not the legacy `["field", <id>, null]` form          |
| `widget-type` | ✓   | the widget/operator; must suit the column type (table below)                                                                              |
| `default`     | —   | e.g. a value, or a `["2024-01-01","2024-12-31"]` range                                                                                    |
| `options`     | —   | filter options map (e.g. case sensitivity), usually `null`                                                                                |
| `alias`       | —   | set when the column comes from an aliased table in the SQL                                                                                |

SQL: bare — `WHERE {{status}}`. Never `WHERE status = {{status}}`. On write, send `{}` for the ref's options; the server fills a `lib/uuid` and the card reads back `["field", {"lib/uuid": "…"}, <id>]`.

### Snippet — `snippet`

```json
"snippet: Active Rows": {
  "type": "snippet",
  "snippet-name": "Active Rows",
  "snippet-id": 5
}
```

SQL: `{{snippet: Active Rows}}` — the map key is the whole `snippet: Name` string. Create and edit the fragment with `snippet_write` (`content` is bare SQL); its id comes back in that tool's result. No user value.

### Card reference — `card`

```json
"#42": {
  "type": "card",
  "card-id": 42
}
```

SQL: `{{#42}}` or `{{#42-slug}}`, used where a table/subquery goes (`FROM {{#42}}`, `WITH x AS {{#42}}`). The map key is the whole `#42` string. Runs with the referenced card's own defaults; no user value.

### Source table — `table` (v59+)

A niche v59+ type that references a warehouse table by id (`{type: "table", table-id: <id>}`, optional `source-filters`) where a table/subquery goes — analogous to a card reference but pointing at a raw table. Absent on v0.58. Reach for a card reference (`card`) unless you specifically need a bare-table source tag.

### Temporal unit — `temporal-unit`

A widget that lets the viewer pick the time bucket (day/week/month/…) for a datetime column. Body mirrors a field filter (`dimension` ref, optional `alias`) with `type: "temporal-unit"`.

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

## Filling a parameter

Metabase derives the card's `parameters` from the template tags — the widget, its type, and its `default` all come from the tag body. Read them back with `get_content` (`include: ["parameters"]`): each carries an `id`, a `slug` (the tag name), a `type`, and a `target` that links it to the tag — `["dimension", ["template-tag", "status"]]` for a field filter, `["variable", ["template-tag", "min_total"]]` for a raw variable.

**Run with values** — `run_saved_question` identifies each parameter by `slug` or `id`, and resolves the rest against the card:

```json
{ "id": 12, "parameters": [{ "slug": "status", "value": "active" }] }
```

Date ranges pass as `"value": ["2024-01-01", "2024-12-31"]`. Omit a parameter entirely to leave an optional (`[[ ]]`) clause out.

**Valid values** — `get_parameter_values` (`{target: "question", id: 12, parameter_id: "<id>"}`) returns `{values, has_more_values}` for a field filter, pulled live from the bound column; `query` narrows to values containing a substring.

**On a dashboard** — a dashcard's `parameter_mappings` entry takes `target_tag: "status"`, and `dashboard_write` compiles it into the same `["dimension"|"variable", ["template-tag", "status"]]` target by reading the tag's type off the card.

## Full native card body

What `question_write` consumes:

```json
{
  "method": "create",
  "name": "Active orders by status",
  "display": "table",
  "visualization_settings": {},
  "native": {
    "database_id": 1,
    "sql": "SELECT status, count(*) FROM orders WHERE total > {{min_total}} [[AND {{status}}]] GROUP BY status",
    "template_tags": {
      "min_total": {
        "type": "number",
        "display-name": "Minimum total",
        "default": "0"
      },
      "status": {
        "type": "dimension",
        "dimension": ["field", {}, 141],
        "widget-type": "string/="
      }
    }
  }
}
```

`native.sql_file` takes a path instead of `sql` — point it at the same `.sql` file you ran with `execute_sql` to save byte-identically what you ran. `{method: "update", id: 12, native: {…}}` replaces the query of an existing card; the tag map is authoritative, so re-send every tag the SQL still uses.
