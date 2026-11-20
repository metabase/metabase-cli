---
title: "mb transform"
summary: "Manage Metabase transforms."
---

# mb transform

Manage Metabase transforms.

Every command on this page takes the [output](README.md#output-flags), [profile](README.md#profile-flags), and [connection](README.md#connection-flags) flags.

Every command on this page needs `transforms` (v59+).

Agent skills:

- `mb skills get transform`: body shape, run-with-wait, iterate
- `mb skills get mbql`: MBQL source.query bodies

## mb transform list

List transforms.

```sh
mb transform list [flags]
```

Also takes the [list](README.md#list-flags) flags.

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

Also takes the [list](README.md#list-flags) flags.

Examples:

```sh
mb transform dependencies 1
mb transform dependencies 1 --json
```

## mb transform create

Create a transform from JSON.

The JSON body needs a `name`, a `source` (the native SQL or MBQL query to run, under `source.query`), and a `target` (the warehouse table to write: `database`, `schema` and `name`). An MBQL 5 `source.query` is checked against the bundled schema (`mb schema query`) before it's sent.

```sh
mb transform create [flags]
```

| Flag | Description |
| --- | --- |
| `--skip-validate` | Skip the local MBQL 5 pre-flight validation; let the server be the authority. Use only when the bundled schema disagrees with what the server accepts. |

Also takes the [body](README.md#body-flags) flags.

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

Patches only the fields you send (any of `name`, `source`, `target`, `tag_ids`, …). A new MBQL 5 `source.query` is checked against the bundled schema (`mb schema query`) before it's sent.

```sh
mb transform update <id> [flags]
```

| Argument or flag | Description |
| --- | --- |
| `<id>` | Transform id. |
| `--skip-validate` | Skip the local MBQL 5 pre-flight validation; let the server be the authority. Use only when the bundled schema disagrees with what the server accepts. |

Also takes the [body](README.md#body-flags) flags.

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

| Argument or flag | Description |
| --- | --- |
| `<id>` | Transform id. |
| `--yes` | Skip confirmation. |

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

| Argument or flag | Description |
| --- | --- |
| `<id>` | Transform id. |
| `--yes` | Skip confirmation. |

Examples:

```sh
mb transform delete-table 1 --yes
mb transform delete-table 1
```

## mb transform run

Trigger a transform run by id.

Starts a run and returns `{ message, run_id }` at once. `--wait` polls the run to a terminal status (`succeeded`, `failed`, `timeout` or `canceled`) and adds it as `final`. `--sync` also waits for the run to register its output table and returns its `target_table_id`, for the cards you build on it, with no `db sync-schema` needed. While waiting, a run that doesn't succeed exits 1.

```sh
mb transform run <id> [flags]
```

| Argument or flag | Description |
| --- | --- |
| `<id>` | Transform id. |
| `--wait` | Poll until the operation reaches a terminal state. |
| `--timeout <value>` | Polling timeout in ms (used with --wait). Default: `600000`. |
| `--interval <value>` | Polling interval in ms (used with --wait). Default: `2000`. |
| `--sync` | After a successful run, wait until the output table is registered and return its id (implies --wait). |

Examples:

```sh
mb transform run 1
mb transform run 1 --wait --json
mb transform run 1 --sync --json
```

## mb transform cancel

Cancel the current run for a transform.

Exits 0 with `{ canceled: true, id }` once the server takes the cancel. A transform with no active run returns a 404, and the command exits 1.

```sh
mb transform cancel <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Transform id. |

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

Examples:

```sh
mb transform get-run 1
mb transform get-run 1 --json
```

## mb transform runs

List recent transform runs.

Lists runs across all transforms, or one transform's with `--transform-id`. The server pages the runs, so the CLI reads only the pages the output cap can show, and reports `has_more` and `next_offset` to continue.

```sh
mb transform runs [flags]
```

| Flag | Description |
| --- | --- |
| `--transform-id <value>` | Filter to runs of a single transform id. |

Also takes the [list](README.md#list-flags) flags.

Examples:

```sh
mb transform runs
mb transform runs --transform-id 1 --json
mb transform runs --limit 10 --json
```
