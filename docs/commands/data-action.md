---
title: "mb data-action"
summary: "Manage Metabase data actions."
---

# mb data-action

Manage Metabase data actions.

Agent skills:

- `mb skills get data-action`: author and run data actions
- `mb skills get native-sql`: the data action's native query and its template tags

## mb data-action list

List data actions.

```sh
mb data-action list [flags]
```

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema data-action list --output`.

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

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema data-action get --output`.

Examples:

```sh
mb data-action get 1
mb data-action get 1 --json --full
```

## mb data-action create

Create a data action from JSON.

A data action writes to a database, filed in a collection, with no model (no `model_id`). A table action inserts, updates, or deletes one row of a table: the JSON body needs `name`, `type: "implicit"`, `kind` (`row/create`, `row/update`, or `row/delete`), and `table_id`, a table with exactly one primary key, and Metabase derives its parameters from the table's columns. A query action is a parameterized native SQL write (`INSERT`, `UPDATE`, `DELETE`): the body needs `name`, `type: "query"`, a native `dataset_query` whose `{{tag}}` placeholders are its inputs and whose `database` the action writes to, and `parameters` targeting those tags. `collection_id` picks a collection in the `data-actions` or `data-apps` namespace (omit for the data actions root; a regular collection is refused, and a data app's collection takes a table action only on a table published to the Library). Data actions are off by default: an admin enables them on the database first (`mb db set-data-actions <id> true`). An MBQL 5 `dataset_query` is checked against a bundled JSON Schema (print it with `mb schema query`) before sending; pass --skip-validate to bypass.

```sh
mb data-action create [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file, or - to read stdin. |
| `--skip-validate` |  | Skip the local MBQL 5 pre-flight validation; let the server be the authority. Use only when the bundled schema disagrees with what the server accepts. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `dataActionsWithoutModel` (v65+).

Body schema: `mb schema data-action create`. Output schema: `mb schema data-action create --output`.

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

The JSON body carries only the fields to change: any of `name`, `parameters`, `collection_id`, `description`, `visualization_settings` and `archived`, plus a query action's `dataset_query` or a table action's `kind` and `table_id`, never both. A server before v65 ignores `collection_id` and `table_id` and answers as if it had applied them, so either key is refused there before the request is sent. A new MBQL 5 `dataset_query` is checked against a bundled JSON Schema (print it with `mb schema query`) before sending; pass --skip-validate to bypass.

```sh
mb data-action update <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Data action id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file, or - to read stdin. |
| `--skip-validate` |  | Skip the local MBQL 5 pre-flight validation; let the server be the authority. Use only when the bundled schema disagrees with what the server accepts. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Body schema: `mb schema data-action update`. Output schema: `mb schema data-action update --output`.

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

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema data-action archive --output`.

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

| Argument | Description |
| --- | --- |
| `<id>` | Data action id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--yes` | `false` | Skip confirmation. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema data-action delete --output`.

Examples:

```sh
mb data-action delete 1 --yes
mb data-action delete 1
```

## mb data-action execute

Run a data action by id.

The JSON body is `{"parameters": {...}}`, keyed by the data action's parameter ids; a table action's are its table's column names, and an update or a delete picks its row by the primary key. The data action writes to its database, so a run cannot be undone by the CLI. A query action answers `rows-affected`; a table action answers `rows-updated`, `rows-deleted`, or the `created-row`.

```sh
mb data-action execute <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Data action id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file, or - to read stdin. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Body schema: `mb schema data-action execute`. Output schema: `mb schema data-action execute --output`.

Agent skills:

- `mb skills get data-action`: the parameter values a data action takes

Examples:

```sh
mb data-action execute 1 --body '{"parameters":{"id":1,"note":"rush"}}'
mb data-action execute 1 --file values.json
```
