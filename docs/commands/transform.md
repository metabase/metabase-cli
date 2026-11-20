---
title: "mb transform"
summary: "Manage Metabase transforms."
---

# mb transform

Manage Metabase transforms.

Agent skills:

- `mb skills get transform`: body shape, run-with-wait, iterate
- `mb skills get mbql`: MBQL source.query bodies

## mb transform list

List transforms.

```sh
mb transform list [flags]
```

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `transforms` (v59+).

Output schema: `mb schema transform list --output`.

Examples:

```sh
mb transform list
mb transform list --json
```

## mb transform get

Get a transform by id.

```sh
mb transform get <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Transform id. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `transforms` (v59+).

Output schema: `mb schema transform get --output`.

Examples:

```sh
mb transform get 1
mb transform get 1 --json
```

## mb transform dependencies

List the transforms a transform depends on.

Returns the upstream transforms in this transform's dependency graph — the ones that must run before it. The positional id is a transform id.

```sh
mb transform dependencies <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Transform id. |

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `transforms` (v59+).

Output schema: `mb schema transform dependencies --output`.

Examples:

```sh
mb transform dependencies 1
mb transform dependencies 1 --json
```

## mb transform create

Create a transform from JSON.

The JSON body needs a `name`, a `source` (the query to run — native SQL or MBQL — under `source.query`), and a `target` (the warehouse table to write, with `database`/`schema`/`name`). When `source.query` is an MBQL 5 query it is checked against a bundled JSON Schema (print it with `mb schema query`) before sending; pass --skip-validate to bypass.

```sh
mb transform create [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file. |
| `--skip-validate` |  | Skip the local MBQL 5 pre-flight validation; let the server be the authority. Use only when the bundled schema disagrees with what the server accepts. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `transforms` (v59+).

Body schema: `mb schema transform create`. Output schema: `mb schema transform create --output`.

Agent skills:

- `mb skills get mbql`: MBQL source.query bodies

Examples:

```sh
cat transform.json | mb transform create
mb transform create --file transform.json
mb transform create --file transform.json --skip-validate
```

## mb transform update

Update a transform by id (partial).

Patches only the fields you send (any of `name`, `source`, `target`, `tag_ids`, …). When a new `source.query` is an MBQL 5 query it is checked against a bundled JSON Schema (print it with `mb schema query`) before sending; pass --skip-validate to bypass.

```sh
mb transform update <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Transform id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file. |
| `--skip-validate` |  | Skip the local MBQL 5 pre-flight validation; let the server be the authority. Use only when the bundled schema disagrees with what the server accepts. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `transforms` (v59+).

Body schema: `mb schema transform update`. Output schema: `mb schema transform update --output`.

Agent skills:

- `mb skills get mbql`: MBQL source.query bodies

Examples:

```sh
cat patch.json | mb transform update 1
mb transform update 1 --file patch.json
mb transform update 1 --body '{"name":"renamed"}'
mb transform update 1 --file patch.json --skip-validate
```

## mb transform delete

Delete a transform by id.

```sh
mb transform delete <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Transform id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--yes` | `false` | Skip confirmation. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `transforms` (v59+).

Output schema: `mb schema transform delete --output`.

Examples:

```sh
mb transform delete 1 --yes
mb transform delete 1
```

## mb transform delete-table

Drop a transform's materialized output table (keeps the transform definition).

```sh
mb transform delete-table <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Transform id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--yes` | `false` | Skip confirmation. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `transforms` (v59+).

Output schema: `mb schema transform delete-table --output`.

Examples:

```sh
mb transform delete-table 1 --yes
mb transform delete-table 1
```

## mb transform run

Trigger a transform run by id.

Starts a run and returns immediately. --wait polls the run to a terminal status. --sync additionally waits until the run's output table is registered and returns its `target_table_id`, so you can build MBQL cards against it — the run registers the table itself, so no separate `db sync-schema` is needed; --sync implies waiting for the run. While waiting, a run that does not succeed exits 1.

```sh
mb transform run <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Transform id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--wait` | `false` | Poll until the operation reaches a terminal state. |
| `--timeout <value>` | `600000` | Polling timeout in ms (used with --wait). |
| `--interval <value>` | `2000` | Polling interval in ms (used with --wait). |
| `--sync` | `false` | After a successful run, wait until the output table is registered and return its id (implies --wait). |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `transforms` (v59+).

Output schema: `mb schema transform run --output`.

Examples:

```sh
mb transform run 1
mb transform run 1 --wait --json
mb transform run 1 --sync --json
```

## mb transform cancel

Cancel the current run for a transform.

```sh
mb transform cancel <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Transform id. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `transforms` (v59+).

Output schema: `mb schema transform cancel --output`.

Examples:

```sh
mb transform cancel 1
mb transform cancel 1 --json
```

## mb transform get-run

Get a transform run by run id (not the transform id).

The positional id is a RUN id (from `transform runs`), not a transform id. To fetch a transform itself, use `transform get <id>`.

```sh
mb transform get-run <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Run id (from `mb transform runs`). |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `transforms` (v59+).

Output schema: `mb schema transform get-run --output`.

Examples:

```sh
mb transform get-run 1
mb transform get-run 1 --json
```

## mb transform runs

List recent transform runs.

```sh
mb transform runs [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--transform-id <value>` |  | Filter to runs of a single transform id. |

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `transforms` (v59+).

Output schema: `mb schema transform runs --output`.

Examples:

```sh
mb transform runs
mb transform runs --transform-id 1 --json
mb transform runs --limit 10 --json
```
