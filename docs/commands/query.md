---
title: "mb query"
summary: "Run, compile, or inspect an ad-hoc MBQL or native query."
---

# mb query

Run, compile, or inspect an ad-hoc MBQL or native query.

## Modes and their output

| Mode              | Prints                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (none)            | The query result.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `--dry-run`       | `{ ok, errors: [{ path, message }], sql }`. The local check runs first; when it passes, the server compiles the query without running it on the warehouse. A local error's `path` is a JSON Pointer into the body and its `message` the schema validator's; a server rejection (HTTP 400, or 500 for a reference it cannot resolve) is one error with `path: ""` and the server's message. `sql` is the compiled native query, `null` when it did not compile. |
| `--compile`       | `{ query, params }`, plus `collection` for a document database when the server reports it. The server inlines parameters into the query, so `params` is `null` for a SQL driver. It is the query as compiled, not as a run executes it: a run also caps an unaggregated query at the server's row limit. Text output is the query alone; a document driver's stage list prints as JSON.                                                                        |
| `--metadata`      | `{ databases, tables, fields, snippets }`. `tables` holds the source table and the tables its foreign keys point at; a card used as a source is a virtual table with a `card__<id>` id. `fields` are the fields native template tags (field filters) and snippets point at; an MBQL body's own columns sit inside its tables. `--full` carries every hydrated field, which exceeds the default `--max-bytes` for most tables.                                  |
| `--export-format` | The export bytes, straight to stdout, capped at the server's download row limit. `--full`, `--fields`, `--max-bytes` and `--limit` are refused, since they shape only the JSON output; `--json` and `--format` still pick the shape of an error.                                                                                                                                                                                                               |

`--pretty` and `--no-pretty` are refused without `--compile`; `--visualization-settings`, `--format-rows`, `--pivot-results` and `--csv-include-bom` without `--export-format`. `--pivot-results` is refused without a `pivot_table.column_split` in `--visualization-settings`.

Compiling, with `--compile` or `--dry-run`, needs native query permission on the body's database and access to every table and card the query reads; without them the server refuses with 403 (exit 1).

## Exit codes

- `0`: the query ran, compiled (`--dry-run`, `--compile`), or was answered (`--metadata`).
- `2`: the local check, or with `--dry-run` the server compile, rejected the body; the body is malformed (one without `lib/type` or `type` included, in every mode); or a flag is wrong.
- `1`: a server-side error after a valid pre-flight (network, HTTP 4xx/5xx), or with `--dry-run` or `--compile` a compile that could not run (no native query permission on the database, no access to a table or card the query reads, server unreachable).

## The MBQL 5 pre-flight

An MBQL 5 body (`"lib/type": "mbql/query"`) uses numeric ids (`database: 1`, `source-table: 7`) and is checked against a bundled JSON Schema before any request, in every mode that reaches the server. `mb schema query` prints that schema; it is synced from a pinned `@metabase/representations` release, with every id `$def` narrowed to a positive integer. A failed check prints `{ ok, errors }` on stdout and exits 2, with no request made.

Any other body skips the check: legacy MBQL 4 (`{ "type": "query", "database": N, "query": { "source-table": T } }`), legacy native (`{ "type": "native", "database": N, "native": { "query": "…" } }`), or any shape without `"lib/type": "mbql/query"`. The server normalizes those, as it does for a saved card or transform. With `--dry-run` such a body goes straight to the server compile. An MBQL 5 query nested inside a legacy `{ "type": "query", "query": … }` envelope is refused before sending, in every mode.

`--skip-validate` skips both checks: it sends the body as it is and lets the server be the authority. Use it only when the bundled schema disagrees with what the server accepts. It cannot be combined with `--dry-run`, whose point is the local check.

## The pre-flight in other commands

[`card create`](card.md#mb-card-create), [`card update`](card.md#mb-card-update), [`transform create`](transform.md#mb-transform-create), [`transform update`](transform.md#mb-transform-update), [`measure create`](measure.md#mb-measure-create), [`measure update`](measure.md#mb-measure-update), [`segment create`](segment.md#mb-segment-create), [`segment update`](segment.md#mb-segment-update), [`data-action create`](data-action.md#mb-data-action-create) and [`data-action update`](data-action.md#mb-data-action-update) run the same check on the query their body carries: a card's or data action's `dataset_query`, a transform's `source.query` when `source.type` is `"query"`, a measure's or segment's `definition`. A failure prints `{ ok, errors }` on stdout and exits 2, with no request made. Legacy MBQL 4 queries and Python transform sources are not checked. Each of these commands takes `--skip-validate`, and `mb schema <command>` names `mb schema query` on the field it checks.

Reads a JSON query body from --body, --file, or stdin and runs it. MBQL 5 is Metabase's structured query format, shaped {"lib/type": "mbql/query", "database": &lt;database id>, "stages": [{"lib/type": "mbql.stage/mbql", "source-table": &lt;table id>, "aggregation": [["count", {}]]}]} with ids from `mb database list` and `mb table list`; it is checked against a bundled JSON Schema before sending, and `mb schema query` prints that schema. --dry-run checks the body without running it: the local schema check, then the server compiles it to native SQL without touching the warehouse. It prints {ok, errors:[{path, message}], sql} and exits 0 when the query compiled, 2 when either check rejected it. Legacy MBQL 4 and legacy native bodies skip the local check. --compile prints the native query the server compiles the body to, --metadata the databases, tables, fields and snippets the body touches, and --export-format streams the rows as csv, json or xlsx; the three are mutually exclusive with each other and with --dry-run. An export takes its column formatting and pivot layout from --visualization-settings, since an ad-hoc query has no card to read them from: --pivot-results needs their pivot_table.column_split.

```sh
mb query [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file, or `-` to read stdin. |
| `--dry-run` |  | Check the body and compile it on the server to native SQL without running it; prints {ok, errors, sql}. |
| `--compile` |  | Print the native query the server compiles the body to, instead of running it. |
| `--metadata` |  | Print the databases, tables, fields and snippets the body references, instead of running it. |
| `--pretty` |  | With --compile: format the native query for reading, as the server does by default; --no-pretty compiles to one line. |
| `--export-format <value>` |  | Bypass the JSON envelope and stream the raw export: csv \| json \| xlsx. |
| `--format-rows` | `false` | Streamed exports only: format values as Metabase displays them, column settings included. |
| `--pivot-results` | `false` | With `--export-format` `csv` or `xlsx`: lay a pivot table's rows out as the pivot, with its subtotals; refused when the server has pivoted exports turned off (the `enable-pivoted-exports` setting). |
| `--csv-include-bom` | `false` | With `--export-format csv`: open the file with a UTF-8 byte order mark, so Excel reads it as UTF-8. Needs `exportCsvByteOrderMark` (v63+): an older server drops the key and exports without the mark, so the CLI refuses it there before the request. |
| `--visualization-settings <value>` |  | With --export-format: JSON object of visualization settings; column settings shape --format-rows, pivot_table.column_split the --pivot-results layout. |
| `--skip-validate` |  | Skip the local MBQL 5 pre-flight validation; let the server be the authority. Use only when the bundled schema disagrees with what the server accepts. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Body schema: `mb schema query`. Output schema: `mb schema query --output`.

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
