---
title: "mb data-action"
summary: "Manage Metabase data actions."
---

# mb data-action

Manage Metabase data actions.

Every command on this page takes the [output](README.md#output-flags), [profile](README.md#profile-flags), and [connection](README.md#connection-flags) flags.

Agent skills:

- `mb skills get data-action`: author and run data actions
- `mb skills get native-sql`: the data action's native query and its template tags

## mb data-action list

List data actions.

```sh
mb data-action list [flags]
```

Also takes the [list](README.md#list-flags) flags.

Examples:

```sh
mb data-action list
mb data-action list --json
```

## mb data-action get

Get a data action by id.

```sh
mb data-action get <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Data action id. |

Examples:

```sh
mb data-action get 1
mb data-action get 1 --json --full
```

## mb data-action create

Create a data action from JSON.

A data action writes to a database. It's filed in a collection and has no model (no `model_id`). Data actions are off by default: an admin turns them on for the database first (`mb db set-data-actions <id> true`).

A table action inserts, updates or deletes one row: the JSON body needs `name`, `type: "implicit"`, `kind` (`row/create`, `row/update` or `row/delete`) and the `table_id` of a table with exactly one primary key. Metabase derives its parameters from the table's columns.

A query action is a parameterized native SQL write (`INSERT`, `UPDATE`, `DELETE`): the body needs `name`, `type: "query"`, a native `dataset_query` whose `{{tag}}` placeholders are its inputs and whose `database` it writes to, and `parameters` that target those tags. An MBQL 5 `dataset_query` is checked against the bundled schema (`mb schema query`) before it's sent.

`collection_id` picks a collection in the `data-actions` or `data-apps` namespace; leave it out for the data actions root. A regular collection is refused, and a data app's collection takes a table action only on a table published to the Library.

```sh
mb data-action create [flags]
```

| Flag | Description |
| --- | --- |
| `--skip-validate` | Skip the local MBQL 5 pre-flight validation; let the server be the authority. Use only when the bundled schema disagrees with what the server accepts. |

Also takes the [body](README.md#body-flags) flags.

Needs `dataActionsWithoutModel` (v65+).

Agent skills:

- `mb skills get data-action`: author a data action and its parameters
- `mb skills get native-sql`: the native query and its template tags

Examples:

```sh
cat data-action.json | mb data-action create
mb data-action create --file data-action.json
mb data-action create --file data-action.json --skip-validate
mb data-action create --body '{"name":"Add customer","type":"implicit","kind":"row/create","table_id":12}'
```

## mb data-action update

Update a data action by id.

The JSON body carries only the fields to change: any of `name`, `parameters`, `collection_id`, `description`, `visualization_settings` and `archived`, plus a query action's `dataset_query` or a table action's `kind` and `table_id`, never both. `collection_id` needs `dataActionCollections` (v65+) and `table_id` needs `dataActionsWithoutModel` (v65+); the CLI refuses them on an older server, which would ignore them but answer as if it had applied them. A new MBQL 5 `dataset_query` is checked against the bundled schema (`mb schema query`) before it's sent.

```sh
mb data-action update <id> [flags]
```

| Argument or flag | Description |
| --- | --- |
| `<id>` | Data action id. |
| `--skip-validate` | Skip the local MBQL 5 pre-flight validation; let the server be the authority. Use only when the bundled schema disagrees with what the server accepts. |

Also takes the [body](README.md#body-flags) flags.

Agent skills:

- `mb skills get data-action`: the fields of a data action

Examples:

```sh
cat patch.json | mb data-action update 1
mb data-action update 1 --file patch.json
mb data-action update 1 --body '{"name":"Rename an order"}'
```

## mb data-action archive

Archive (soft-delete) a data action by id.

```sh
mb data-action archive <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Data action id. |

Examples:

```sh
mb data-action archive 1
```

## mb data-action delete

Delete a data action by id.

Deletes the data action and the dashboard buttons that run it.

```sh
mb data-action delete <id> [flags]
```

| Argument or flag | Description |
| --- | --- |
| `<id>` | Data action id. |
| `--yes` | Skip confirmation. |

Examples:

```sh
mb data-action delete 1 --yes
mb data-action delete 1
```

## mb data-action execute

Run a data action by id.

The JSON body is `{"parameters": {...}}`, keyed by the data action's parameter ids; a table action's are its table's column names, and an update or a delete picks its row by the primary key. A run writes to the database and can't be undone. A query action answers `rows-affected`; a table action answers `rows-updated`, `rows-deleted`, or the `created-row`.

```sh
mb data-action execute <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Data action id. |

Also takes the [body](README.md#body-flags) flags.

Agent skills:

- `mb skills get data-action`: the parameter values a data action takes

Examples:

```sh
mb data-action execute 1 --body '{"parameters":{"id":1,"note":"rush"}}'
mb data-action execute 1 --file values.json
```
