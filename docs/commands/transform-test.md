---
title: "mb transform-test"
summary: "Manage transform tests — fixtures and expectations run against temp tables."
---

# mb transform-test

Manage transform tests — fixtures and expectations run against temp tables.

Every command on this page takes the [output](README.md#output-flags), [profile](README.md#profile-flags), and [connection](README.md#connection-flags) flags.

Every command on this page needs `transformTests` (v65+, token transforms-testing).

## Only query transforms can be tested

Only query transforms (native SQL or MBQL) can be tested, on Postgres, MySQL, H2, ClickHouse, Redshift or SQL Server. The server refuses any other transform with `transform-test.unsupported-transform`, and any other database with `transform-test.unsupported-driver`.

## Expectation SQL reads only the test's tables

Expectation names must be unique within a test. Expectation SQL may name only the transform's target table and its declared input tables, which the run rewrites to its temp tables. Any other table is refused with `transform-test.unremapped-reference`, and so is a column qualified by a table name instead of an alias (`FROM people p … p.id` passes, `people.id` doesn't), in expectation SQL and the transform's own SQL alike.

## mb transform-test list

List transform tests.

```sh
mb transform-test list [flags]
```

| Flag | Description |
| --- | --- |
| `--transform-id <value>` | Only the tests of this transform id. |

Also takes the [list](README.md#list-flags) flags.

Examples:

```sh
mb transform-test list
mb transform-test list --transform-id 1 --json
```

## mb transform-test get

Get a transform test by id.

The compact form carries the id, transform, name and description. `--full` adds the `inputs` and `expectations`: the body to edit and send to `update` once you drop `id`, `entity_id`, `creator_id`, `created_at` and `updated_at`.

```sh
mb transform-test get <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Transform test id. |

Examples:

```sh
mb transform-test get 1
mb transform-test get 1 --full --json
```

## mb transform-test create

Create a transform test from JSON.

The JSON body needs a `transform_id`, a `name`, `inputs` that stand in for every table the transform reads, and `expectations` to check against its output. An input names its `table` and has either `format: "sql"` with a `sql` query, or `format: "rows"` with `columns` (each a `name` and a `cast_type` the warehouse can `CAST` to) and `rows` that carry exactly those columns.

An expectation is either `type: "empty"` with `sql` that must return nothing, or `type: "equals"` with `format: "rows"` and the `columns` and `rows` the output must hold exactly. The body is closed at every level, so a test read with `get --full` must drop `id`, `entity_id`, `creator_id`, `created_at` and `updated_at` before it's sent.

```sh
mb transform-test create [flags]
```

Also takes the [body](README.md#body-flags) flags.

Examples:

```sh
cat transform-test.json | mb transform-test create
mb transform-test create --file transform-test.json
```

## mb transform-test update

Update a transform test from JSON.

Patches only the fields the body carries; `inputs` and `expectations` replace what's stored. The body is closed at every level, so a test read with `get --full` must drop `id`, `entity_id`, `creator_id`, `created_at` and `updated_at` before it's sent.

```sh
mb transform-test update <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Transform test id. |

Also takes the [body](README.md#body-flags) flags.

Examples:

```sh
cat patch.json | mb transform-test update 1
mb transform-test update 1 --file patch.json
mb transform-test update 1 --body '{"name":"renamed"}'
mb transform-test get 1 --full --json | jq 'del(.id, .entity_id, .creator_id, .created_at, .updated_at)' | mb transform-test update 1
```

## mb transform-test delete

Delete a transform test by id.

```sh
mb transform-test delete <id> [flags]
```

| Argument or flag | Description |
| --- | --- |
| `<id>` | Transform test id. |
| `--yes` | Skip confirmation. |

Examples:

```sh
mb transform-test delete 1 --yes
mb transform-test delete 1
```

## mb transform-test run

Run a transform test by id.

Builds temp tables from the test's inputs, runs the transform against them, checks every expectation against its output, and drops the temp tables. A `format: "sql"` input runs verbatim against the transform's source database. The run is one synchronous request, so `--timeout` bounds all of it; `--json` reports what each expectation found, including the rows a comparison disagreed on. A test that doesn't pass exits 1, even when its report is over `--max-bytes` and isn't printed, and the error names the expectations that failed.

```sh
mb transform-test run <id> [flags]
```

| Argument or flag | Description |
| --- | --- |
| `<id>` | Transform test id. |
| `--timeout <value>` | Request timeout in ms. Default: `30000`. |

Examples:

```sh
mb transform-test run 1
mb transform-test run 1 --json
mb transform-test run 1 --timeout 300000
```
