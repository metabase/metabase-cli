---
title: "mb transform-test"
summary: "Manage transform tests — fixtures and expectations run against temp tables."
---

# mb transform-test

Manage transform tests — fixtures and expectations run against temp tables.

## What can be tested

Only query transforms (native SQL or MBQL) can be tested, on Postgres, MySQL, H2, ClickHouse, Redshift or SQL Server. The server refuses any other transform with `transform-test.unsupported-transform`, and any other database with `transform-test.unsupported-driver`.

## Expectation rules

Expectation names are unique within a test. Expectation SQL may name only the transform's target table and its declared input tables, which are rewritten to the run's temp tables. Any other table is refused with `transform-test.unremapped-reference`, and so is a column qualified by a table name rather than an alias (`FROM people p … p.id` passes, `people.id` does not), in expectation SQL and in the transform's own SQL alike.

## mb transform-test list

List transform tests.

```sh
mb transform-test list [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--transform-id <value>` |  | Only the tests of this transform id. |

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `transformTests` (v65+, token transforms-testing).

Output schema: `mb schema transform-test list --output`.

Examples:

```sh
mb transform-test list
mb transform-test list --transform-id 1 --json
```

## mb transform-test get

Get a transform test by id.

The compact form carries the id, transform, name and description. Pass --full for the `inputs` and `expectations` themselves, which is also the body to edit and send back to `update` once `id`, `entity_id`, `creator_id`, `created_at` and `updated_at` are shed.

```sh
mb transform-test get <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Transform test id. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `transformTests` (v65+, token transforms-testing).

Output schema: `mb schema transform-test get --output`.

Examples:

```sh
mb transform-test get 1
mb transform-test get 1 --full --json
```

## mb transform-test create

Create a transform test from JSON.

The JSON body needs a `transform_id`, a `name`, the `inputs` standing in for every table the transform reads, and the `expectations` checked against its output. An input names its `table` and carries either `format: "sql"` with a `sql` query or `format: "rows"` with `columns` (each a `name` and a `cast_type` the warehouse accepts as a `CAST` target) and `rows`, each row carrying exactly the declared columns. An expectation is either `type: "empty"` with the `sql` that must return nothing, or `type: "equals"` with `format: "rows"` and the `columns` and `rows` the output must hold exactly. The body is closed at every level: a test read back with `get --full` has to shed `id`, `entity_id`, `creator_id`, `created_at` and `updated_at` before it can be sent.

```sh
mb transform-test create [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file, or `-` to read stdin. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `transformTests` (v65+, token transforms-testing).

Body schema: `mb schema transform-test create`. Output schema: `mb schema transform-test create --output`.

Examples:

```sh
cat transform-test.json | mb transform-test create
mb transform-test create --file transform-test.json
```

## mb transform-test update

Update a transform test from JSON.

Only the fields the body carries are patched. `inputs` and `expectations` replace what is stored rather than merging into it. The body is closed at every level: a test read back with `get --full` has to shed `id`, `entity_id`, `creator_id`, `created_at` and `updated_at` before it can be sent.

```sh
mb transform-test update <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Transform test id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file, or `-` to read stdin. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `transformTests` (v65+, token transforms-testing).

Body schema: `mb schema transform-test update`. Output schema: `mb schema transform-test update --output`.

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

| Argument | Description |
| --- | --- |
| `<id>` | Transform test id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--yes` | `false` | Skip confirmation. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `transformTests` (v65+, token transforms-testing).

Output schema: `mb schema transform-test delete --output`.

Examples:

```sh
mb transform-test delete 1 --yes
mb transform-test delete 1
```

## mb transform-test run

Run a transform test by id.

Runs the transform against temp tables built from the test's inputs, checks every expectation against its output, and drops the temp tables. The transform and the expectations read only those temp tables; a `format: "sql"` input runs verbatim against the transform's source database. The run is one synchronous request, so --timeout bounds the whole of it. --json reports what each expectation found, including the rows a comparison disagreed on. A test that does not pass exits 1, also when its report is over --max-bytes and is not printed; the error then names the expectations that did not pass.

```sh
mb transform-test run <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Transform test id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--timeout <value>` | `30000` | Request timeout in ms. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `transformTests` (v65+, token transforms-testing).

Output schema: `mb schema transform-test run --output`.

Examples:

```sh
mb transform-test run 1
mb transform-test run 1 --json
mb transform-test run 1 --timeout 300000
```
