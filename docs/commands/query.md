---
title: "mb query"
summary: "Run, compile, or inspect an ad-hoc MBQL or native query."
---

# mb query

Run, compile, or inspect an ad-hoc MBQL or native query.

## Modes and their output

| Mode              | Prints                                                                                                                                                                                                                                                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (none)            | The query result.                                                                                                                                                                                                                                                                                                                            |
| `--dry-run`       | `{ ok, errors: [{ path, message }], sql }`. The local check runs first; if it passes, the server compiles the query without running it. A local error's `path` is a JSON Pointer into the body. A server rejection (HTTP 400, or 500 for a reference it can't resolve) is one error with `path: ""`. `sql` is the compiled query, or `null`. |
| `--compile`       | `{ query, params }`, plus `collection` for a document database. `params` is `null` for a SQL driver, since the server inlines parameters. A run also caps an unaggregated query at the server's row limit, which the compiled query doesn't show. Text output is the query alone.                                                            |
| `--metadata`      | `{ databases, tables, fields, snippets }`: the source table and the tables its foreign keys point at (a card source is a virtual table with a `card__<id>` id), and the fields that template tags and snippets point at. With `--full`, most tables exceed the default `--max-bytes`.                                                        |
| `--export-format` | The export bytes on stdout, capped at the server's download row limit. `--full`, `--fields`, `--max-bytes` and `--limit` are refused; `--json` and `--format` set only the shape of an error.                                                                                                                                                |

`--pretty` and `--no-pretty` are refused without `--compile`; `--visualization-settings`, `--format-rows`, `--pivot-results` and `--csv-include-bom` without `--export-format`. `--pivot-results` also needs a `pivot_table.column_split` in `--visualization-settings`.

To compile, with `--compile` or `--dry-run`, you need native query permission on the body's database and access to every table and card the query reads. Without them, the server refuses with 403 (exit 1).

## Exit codes

| Code | When                                                                                                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | The query ran, compiled, or its metadata was read.                                                                                                                                    |
| `2`  | A flag is wrong, the body is malformed (it has neither `lib/type` nor `type`), or the local check rejected it. With `--dry-run`, also when the server compile rejected it.            |
| `1`  | A server error after the local check passed: network, HTTP 4xx or 5xx, or a compile the server refused (no native query permission, or no access to a table or card the query reads). |

## The MBQL 5 pre-flight

An MBQL 5 body (`"lib/type": "mbql/query"`, with numeric ids such as `database: 1`) is checked against a bundled JSON Schema before any request. A failed check prints `{ ok, errors }` on stdout and exits 2. `mb schema query` prints the schema, which comes from a pinned `@metabase/representations` release with every id narrowed to a positive integer.

Other bodies skip the check, and the server normalizes them: legacy MBQL 4 (`{ "type": "query", "database": N, "query": { "source-table": T } }`) and legacy native (`{ "type": "native", "database": N, "native": { "query": "…" } }`). With `--dry-run`, such a body goes straight to the server compile. An MBQL 5 query inside a legacy `{ "type": "query", "query": … }` envelope is refused before sending.

`--skip-validate` skips these checks and sends the body as it is. Use it only when the bundled schema disagrees with what the server accepts. It can't be combined with `--dry-run`, whose point is the check.

## The pre-flight in other commands

The `create` and `update` commands of [card](card.md), [transform](transform.md), [measure](measure.md), [segment](segment.md) and [data-action](data-action.md) run the same check on the query in their body: a card's or data action's `dataset_query`, a transform's `source.query` (when `source.type` is `"query"`), and a measure's or segment's `definition`. A failure exits 2 the same way, and each command takes `--skip-validate`. Legacy MBQL 4 queries and Python transform sources aren't checked.

Runs the JSON query body from `--body`, `--file`, or stdin. An MBQL 5 body, shaped `{"lib/type": "mbql/query", "database": <db-id>, "stages": [{"lib/type": "mbql.stage/mbql", "source-table": <table-id>}]}` with ids from `mb db list` and `mb table list`, is checked against the schema `mb schema query` prints, and one that fails exits 2 with no request made. Legacy MBQL 4 and native bodies skip the check. `--dry-run`, `--compile`, `--metadata` and `--export-format` check, compile, inspect or export the query instead of running it, and you can use only one of them.

```sh
mb query [flags]
```

| Flag | Description |
| --- | --- |
| `--dry-run` | Check the body and compile it on the server to native SQL without running it; prints {ok, errors, sql}. |
| `--compile` | Print the native query the server compiles the body to, instead of running it. |
| `--metadata` | Print the databases, tables, fields and snippets the body references, instead of running it. |
| `--pretty` | With --compile: format the native query for reading, as the server does by default; --no-pretty compiles to one line. |
| `--export-format <value>` | Bypass the JSON envelope and stream the raw export: csv \| json \| xlsx. |
| `--format-rows` | Streamed exports only: format values as Metabase displays them, column settings included. |
| `--pivot-results` | With `--export-format` `csv` or `xlsx`: lay a pivot table's rows out as the pivot, with its subtotals; refused when the server has pivoted exports turned off (the `enable-pivoted-exports` setting). |
| `--csv-include-bom` | With `--export-format csv`: start the file with a UTF-8 byte order mark, so Excel reads it as UTF-8. Refused (exit 2) on a server without `exportCsvByteOrderMark` (v63+). |
| `--visualization-settings <value>` | With --export-format: JSON object of visualization settings; column settings shape --format-rows, pivot_table.column_split the --pivot-results layout. |
| `--skip-validate` | Skip the local MBQL 5 pre-flight validation; let the server be the authority. Use only when the bundled schema disagrees with what the server accepts. |

Takes the [output](README.md#output-flags), [body](README.md#body-flags), [profile](README.md#profile-flags), and [connection](README.md#connection-flags) flags.

Agent skills:

- `mb skills get mbql`: body shape, clause rules, and the dry-run loop

Examples:

```sh
mb schema query
cat q.json | mb query --dry-run
mb query --file q.json
mb query --file q.json --compile
mb query --file q.json --compile --no-pretty --format text
mb query --file q.json --metadata --json
mb query --file q.json --export-format csv > rows.csv
mb query --file pivot.json --export-format xlsx --pivot-results --visualization-settings '{"pivot_table.column_split":{"rows":["category"],"columns":["status"],"values":["count"]}}' > pivot.xlsx
mb query --file q.json --skip-validate
```
