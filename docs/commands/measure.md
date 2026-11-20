---
title: "mb measure"
summary: "Manage Metabase measures."
---

# mb measure

Manage Metabase measures.

Every command on this page takes the [output](README.md#output-flags), [profile](README.md#profile-flags), and [connection](README.md#connection-flags) flags.

Every command on this page needs `measures` (v59+).

Agent skills:

- `mb skills get mbql`: the definition aggregation
- `mb skills get data-workflow`: define reusable measures

## mb measure list

List measures.

```sh
mb measure list [flags]
```

Also takes the [list](README.md#list-flags) flags.

Examples:

```sh
mb measure list
mb measure list --json
```

## mb measure get

Get a measure by id.

```sh
mb measure get <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Measure id. |

Examples:

```sh
mb measure get 1
mb measure get 1 --json
```

## mb measure create

Create a measure (saved aggregation) from JSON.

A measure is a saved aggregation on a table, which cards and metrics reuse. The JSON body needs `name`, `table_id` and a `definition` (an MBQL query with exactly one aggregation). An MBQL 5 `definition` is checked against the bundled schema (`mb schema query`) before it's sent.

```sh
mb measure create [flags]
```

| Flag | Description |
| --- | --- |
| `--skip-validate` | Skip the local MBQL 5 pre-flight validation; let the server be the authority. Use only when the bundled schema disagrees with what the server accepts. |

Also takes the [body](README.md#body-flags) flags.

Agent skills:

- `mb skills get mbql`: the definition aggregation

Examples:

```sh
cat measure.json | mb measure create
mb measure create --file measure.json
mb measure create --file measure.json --skip-validate
```

## mb measure update

Update a measure by id (body must include revision_message).

Patches only the fields you send, and needs a `revision_message` for the audit log. A new MBQL 5 `definition` is checked against the bundled schema (`mb schema query`) before it's sent.

```sh
mb measure update <id> [flags]
```

| Argument or flag | Description |
| --- | --- |
| `<id>` | Measure id. |
| `--skip-validate` | Skip the local MBQL 5 pre-flight validation; let the server be the authority. Use only when the bundled schema disagrees with what the server accepts. |

Also takes the [body](README.md#body-flags) flags.

Agent skills:

- `mb skills get mbql`: the definition aggregation

Examples:

```sh
cat patch.json | mb measure update 1
mb measure update 1 --file patch.json
mb measure update 1 --body '{"name":"renamed","revision_message":"rename"}'
mb measure update 1 --file patch.json --skip-validate
```

## mb measure archive

Archive (soft-delete) a measure by id.

```sh
mb measure archive <id> [flags]
```

| Argument or flag | Description |
| --- | --- |
| `<id>` | Measure id. |
| `--revision-message <value>` | Audit-log message recorded with the change. Default: `Archived via mb CLI`. |

Examples:

```sh
mb measure archive 1
mb measure archive 1 --revision-message "deprecated"
```
