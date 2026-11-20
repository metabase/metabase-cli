---
title: "mb card"
summary: "Manage Metabase cards (questions, models, metrics)."
---

# mb card

Manage Metabase cards (questions, models, metrics).

Every command on this page takes the [output](README.md#output-flags), [profile](README.md#profile-flags), and [connection](README.md#connection-flags) flags.

Agent skills:

- `mb skills get mbql`: author the dataset_query
- `mb skills get visualization`: choose display and visualization_settings

## mb card list

List cards (questions, models, metrics).

```sh
mb card list [flags]
```

| Flag | Description |
| --- | --- |
| `--filter <value>` | Filter preset: all\|mine\|bookmarked\|database\|table\|archived\|using_model\|using_segment. Default: `all`. |
| `--model-id <value>` | Required with `--filter database\|table\|using_model\|using_segment`: the ID of that database, table, model or segment. |

Also takes the [list](README.md#list-flags) flags.

Examples:

```sh
mb card list
mb card list --filter archived --json
mb card list --filter using_model --model-id 42 --json
```

## mb card get

Get a card by id.

```sh
mb card get <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Card id. |

Examples:

```sh
mb card get 1
mb card get 1 --json
```

## mb card query

Run a saved card and return results (json envelope, or stream CSV/JSON/XLSX via --export-format).

Without `--export-format`, prints Metabase's result envelope (`status`, `row_count`, `data: { rows, cols }`, …). Rows stop at the server's row limit; when they're cut, `data.rows_truncated` (`pivot_rows_truncated` for a pivot) gives the limit. A cached result carries the time it was computed in `cached`. With `--export-format`, the export streams to stdout, capped at the server's download row limit, and `--full`, `--fields`, `--max-bytes` and `--limit` are refused. `--format-rows`, `--pivot-results` and `--csv-include-bom` are refused without `--export-format`.

```sh
mb card query <id> [flags]
```

| Argument or flag | Description |
| --- | --- |
| `<id>` | Card id. |
| `--export-format <value>` | Bypass the JSON envelope and stream the raw export: csv \| json \| xlsx. |
| `--format-rows` | Streamed exports only: format values as Metabase displays them, column settings included. |
| `--pivot-results` | With `--export-format` `csv` or `xlsx`: lay a pivot table's rows out as the pivot, with its subtotals; refused when the server has pivoted exports turned off (the `enable-pivoted-exports` setting). |
| `--csv-include-bom` | With `--export-format csv`: start the file with a UTF-8 byte order mark, so Excel reads it as UTF-8. Refused (exit 2) on a server without `exportCsvByteOrderMark` (v63+). |
| `--parameters <value>` | JSON array of Metabase parameter objects to pass with the query, in the shape Metabase sends from a dashboard. |
| `--limit <value>` | Cap rows kept in the JSON envelope; refused with --export-format. |
| `--ignore-cache` | Run the query against the database even when a cached result would be served; refused with --export-format. |

Examples:

```sh
mb card query 1
mb card query 1 --json --limit 20
mb card query 1 --ignore-cache
mb card query 1 --export-format csv > results.csv
mb card query 1 --export-format json > results.json
mb card query 1 --export-format xlsx > results.xlsx
mb card query 1 --parameters '[{"type":"category","value":"A","target":["variable",["template-tag","c"]]}]'
```

## mb card alerts

List alerts watching a card.

Manage them with `mb alert create|update|send|archive`, which take the alert id printed here.

```sh
mb card alerts <id> [flags]
```

| Argument or flag | Description |
| --- | --- |
| `<id>` | Card id. |
| `--include-inactive` | Include archived (inactive) alerts. |

Also takes the [list](README.md#list-flags) flags.

Examples:

```sh
mb card alerts 94
mb card alerts 94 --include-inactive --json
```

## mb card create

Create a card (question, model, or metric) from JSON.

The JSON body needs `name`, `display` (the visualization, such as `table`, `bar` or `scalar`), `dataset_query`, and `visualization_settings` (`{}` is fine). An MBQL 5 `dataset_query` is checked against the bundled schema (`mb schema query`) before it's sent: fix the errors it reports, or pass `--skip-validate`. Native SQL and legacy queries are sent unchecked.

```sh
mb card create [flags]
```

| Flag | Description |
| --- | --- |
| `--skip-validate` | Skip the local MBQL 5 pre-flight validation; let the server be the authority. Use only when the bundled schema disagrees with what the server accepts. |

Also takes the [body](README.md#body-flags) flags.

Agent skills:

- `mb skills get mbql`: author an MBQL dataset_query
- `mb skills get native-sql`: author a native SQL dataset_query with parameters
- `mb skills get visualization`: choose display and visualization_settings

Examples:

```sh
cat card.json | mb card create
mb card create --file card.json
mb card create --body '{"name":"x","display":"table","dataset_query":{...},"visualization_settings":{}}'
mb card create --file card.json --skip-validate
```

## mb card update

Update a card by id (partial).

Changes only the fields you send, such as `name`, `display`, `dataset_query`, `visualization_settings`, `description`, `collection_id`, `dashboard_id`, `parameters` or `archived`. An MBQL 5 `dataset_query` is checked against the bundled schema (`mb schema query`) before it's sent; pass `--skip-validate` to skip the check.

```sh
mb card update <id> [flags]
```

| Argument or flag | Description |
| --- | --- |
| `<id>` | Card id. |
| `--skip-validate` | Skip the local MBQL 5 pre-flight validation; let the server be the authority. Use only when the bundled schema disagrees with what the server accepts. |

Also takes the [body](README.md#body-flags) flags.

Agent skills:

- `mb skills get mbql`: author the dataset_query
- `mb skills get visualization`: choose display and visualization_settings

Examples:

```sh
cat patch.json | mb card update 1
mb card update 1 --file patch.json
mb card update 1 --body '{"name":"renamed"}'
mb card update 1 --body '{"display":"bar"}'
mb card update 1 --body '{"archived":true}'
mb card update 1 --file patch.json --skip-validate
```

## mb card verify

Mark a card verified, or withdraw the mark with --remove.

Adds a moderation review that marks the card verified (admins only). Verified content shows a check mark and ranks higher in search, and `mb search --verified` finds only verified content. `--remove` adds a review with no status, which withdraws the mark, and so does a change to the card's query. Prints the review, whose `status` is `verified` or `null`; `card get <id> --fields moderation_reviews` lists every review, newest first.

```sh
mb card verify <id> [flags]
```

| Argument or flag | Description |
| --- | --- |
| `<id>` | Card id. |
| `--text <value>` | Note stored with the review. |
| `--remove` | Withdraw the verification instead of granting it. |

Needs `contentVerification` (token content_verification).

Examples:

```sh
mb card verify 1
mb card verify 1 --text "Reviewed the joins" --json
mb card verify 1 --remove
```

## mb card archive

Archive (soft-delete) a card by id.

Sets `archived: true`. The card stays readable through `card list --filter archived` and `card get <id>`; `mb card update <id> --body '{"archived":false}'` restores it.

```sh
mb card archive <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Card id. |

Examples:

```sh
mb card archive 1
mb card archive 1 --json
```
