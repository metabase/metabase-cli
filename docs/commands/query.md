---
title: "mb query"
summary: "Run, compile, or inspect an ad-hoc MBQL or native query."
---

# mb query

Run, compile, or inspect an ad-hoc MBQL or native query.

Reads a JSON query body from --body, --file, or stdin and runs it. MBQL 5 is Metabase's structured query format, shaped {"lib/type": "mbql/query", "database": &lt;database id>, "stages": [{"lib/type": "mbql.stage/mbql", "source-table": &lt;table id>, "aggregation": [["count", {}]]}]} with ids from `mb database list` and `mb table list`; it is checked against a bundled JSON Schema before sending, and `mb schema query` prints that schema. --dry-run checks the body without running it: the local schema check, then the server compiles it to native SQL without touching the warehouse. It prints {ok, errors:[{path, message}], sql} and exits 0 when the query compiled, 2 when either check rejected it. Legacy MBQL 4 and legacy native bodies skip the local check. --compile prints the native query the server compiles the body to, --metadata the databases, tables, fields and snippets the body touches, and --export-format streams the rows as csv, json or xlsx; the three are mutually exclusive with each other and with --dry-run. An export takes its column formatting and pivot layout from --visualization-settings, since an ad-hoc query has no card to read them from: --pivot-results needs their pivot_table.column_split.

```sh
mb query [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file. |
| `--dry-run` |  | Check the body and compile it on the server to native SQL without running it; prints {ok, errors, sql}. |
| `--compile` |  | Print the native query the server compiles the body to, instead of running it. |
| `--metadata` |  | Print the databases, tables, fields and snippets the body references, instead of running it. |
| `--pretty` |  | With --compile: format the native query for reading, as the server does by default; --no-pretty compiles to one line. |
| `--export-format <value>` |  | Bypass the JSON envelope and stream the raw export: csv \| json \| xlsx. |
| `--format-rows` | `false` | Streamed exports only: format values as Metabase displays them, column settings included. |
| `--pivot-results` | `false` | With --export-format csv or xlsx: lay a pivot table's rows out as the pivot, with its subtotals; refused when the server has pivoted exports turned off. |
| `--csv-include-bom` | `false` | With --export-format csv: open the file with a UTF-8 byte order mark, so Excel reads it as UTF-8. |
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
mb query --file q.json --metadata --json
mb query --file q.json --export-format csv > rows.csv
mb query --file q.json --skip-validate
```
