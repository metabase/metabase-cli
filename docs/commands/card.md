---
title: "mb card"
summary: "Manage Metabase cards (questions, models, metrics)."
---

# mb card

Manage Metabase cards (questions, models, metrics).

Agent skills:

- `mb skills get mbql`: author the dataset_query
- `mb skills get visualization`: choose display and visualization_settings

## mb card list

List cards (questions, models, metrics).

```sh
mb card list [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--filter <value>` | `all` | Filter preset: all\|mine\|bookmarked\|database\|table\|archived\|using_model\|using_segment. |
| `--model-id <value>` |  | Required with --filter database\|table\|using_model\|using_segment: the id of that database, table, model or segment. |

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema card list --output`.

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

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema card get --output`.

Examples:

```sh
mb card get 1
mb card get 1 --json
```

## mb card query

Run a saved card and return results (json envelope, or stream CSV/JSON/XLSX via --export-format).

Without --export-format, prints Metabase's result envelope (`status`, `row_count`, `data: { rows, cols }`, …), whose rows stop at the server's row limit for an API run: when the server cut them, `data.rows_truncated` (`pivot_rows_truncated` for a pivot) carries the limit and the text summary says so. A result served from the cache carries the time it was computed in `cached`. With --export-format, the export bytes stream straight to stdout, capped at the server's download row limit; --full, --fields, --max-bytes and --limit are refused, since they shape only the JSON output, and --json and --format still pick the shape of an error. --format-rows, --pivot-results and --csv-include-bom are refused without --export-format.

```sh
mb card query <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Card id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--export-format <value>` |  | Bypass the JSON envelope and stream the raw export: csv \| json \| xlsx. |
| `--format-rows` | `false` | Streamed exports only: format values as Metabase displays them, column settings included. |
| `--pivot-results` | `false` | With --export-format csv or xlsx: lay a pivot table's rows out as the pivot, with its subtotals; refused when the server has pivoted exports turned off (the enable-pivoted-exports setting). |
| `--csv-include-bom` | `false` | With --export-format csv: open the file with a UTF-8 byte order mark, so Excel reads it as UTF-8. Needs exportCsvByteOrderMark (v63+): an older server drops the key and exports without the mark, so the CLI refuses it there before the request. |
| `--parameters <value>` |  | JSON array of Metabase parameter objects to pass with the query, in the shape Metabase sends from a dashboard. |
| `--limit <value>` |  | Cap rows kept in the JSON envelope; refused with --export-format. |
| `--ignore-cache` | `false` | Run the query against the database even when a cached result would be served; refused with --export-format. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema card query --output`.

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

| Argument | Description |
| --- | --- |
| `<id>` | Card id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--include-inactive` |  | Include archived (inactive) alerts. |

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema card alerts --output`.

Examples:

```sh
mb card alerts 94
mb card alerts 94 --include-inactive --json
```

## mb card create

Create a card (question, model, or metric) from JSON.

The JSON body needs `name`, `display` (the visualization — e.g. table, bar, scalar), `dataset_query` (the query powering the card), and `visualization_settings` (`{}` is fine). When `dataset_query` is an MBQL 5 query it is checked against a bundled JSON Schema (print it with `mb schema query`) before sending — fix the reported errors, or pass --skip-validate to send anyway. Native-SQL and legacy queries are sent unchecked.

```sh
mb card create [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file, or - to read stdin. |
| `--skip-validate` |  | Skip the local MBQL 5 pre-flight validation; let the server be the authority. Use only when the bundled schema disagrees with what the server accepts. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Body schema: `mb schema card create`. Output schema: `mb schema card create --output`.

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

Patches only the fields you send (any of `name`, `display`, `dataset_query`, `visualization_settings`, `description`, `collection_id`, `dashboard_id`, `parameters`, `archived`, …). When `dataset_query` is an MBQL 5 query it is checked against a bundled JSON Schema (print it with `mb schema query`) before sending; pass --skip-validate to bypass.

```sh
mb card update <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Card id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file, or - to read stdin. |
| `--skip-validate` |  | Skip the local MBQL 5 pre-flight validation; let the server be the authority. Use only when the bundled schema disagrees with what the server accepts. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Body schema: `mb schema card update`. Output schema: `mb schema card update --output`.

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

Records a moderation review on the card (admins only). Verified content carries a check mark in the product and ranks higher in search; `mb search --verified` finds only verified content. Each call adds a review and makes it the card's most recent one; `--remove` records a review with no status, which withdraws the verification. Changing the card's query (an update with a new `dataset_query`, or a revision revert) withdraws it too: the server records a review with no status and a note that the edit unverified it. `card get <id> --fields moderation_reviews` reads the reviews, newest first; the first one's `status` is the current state. Prints the review, whose `status` is `verified` or `null`; `--full` adds `moderator_id` and the timestamps.

```sh
mb card verify <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Card id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--text <value>` |  | Note stored with the review. |
| `--remove` |  | Withdraw the verification instead of granting it. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `contentVerification` (token content_verification).

Output schema: `mb schema card verify --output`.

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

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema card archive --output`.

Examples:

```sh
mb card archive 1
mb card archive 1 --json
```
