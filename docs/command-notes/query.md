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
