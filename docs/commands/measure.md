---
title: "mb measure"
summary: "Manage Metabase measures."
---

# mb measure

Manage Metabase measures.

Agent skills:

- `mb skills get mbql`: the definition aggregation
- `mb skills get data-workflow`: define reusable measures

## mb measure list

List measures.

```sh
mb measure list [flags]
```

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `measures` (v59+).

Output schema: `mb schema measure list --output`.

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

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `measures` (v59+).

Output schema: `mb schema measure get --output`.

Examples:

```sh
mb measure get 1
mb measure get 1 --json
```

## mb measure create

Create a measure (saved aggregation) from JSON.

A measure is a reusable, saved aggregation tied to a table, which cards and metrics reference to share the computation. The JSON body needs `name`, `table_id`, and a `definition` (an MBQL query holding exactly one aggregation). An MBQL 5 `definition` is checked against a bundled JSON Schema (print it with `mb schema query`) before sending; pass `--skip-validate` to bypass.

```sh
mb measure create [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file, or `-` to read stdin. |
| `--skip-validate` |  | Skip the local MBQL 5 pre-flight validation; let the server be the authority. Use only when the bundled schema disagrees with what the server accepts. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `measures` (v59+).

Body schema: `mb schema measure create`. Output schema: `mb schema measure create --output`.

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

Patches only the fields you send and must include `revision_message` (recorded in the audit log). When `definition` is an MBQL 5 query it is checked against a bundled JSON Schema (print it with `mb schema query`) before sending; pass `--skip-validate` to bypass.

```sh
mb measure update <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Measure id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file, or `-` to read stdin. |
| `--skip-validate` |  | Skip the local MBQL 5 pre-flight validation; let the server be the authority. Use only when the bundled schema disagrees with what the server accepts. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `measures` (v59+).

Body schema: `mb schema measure update`. Output schema: `mb schema measure update --output`.

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

| Argument | Description |
| --- | --- |
| `<id>` | Measure id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--revision-message <value>` | `Archived via mb CLI` | Audit-log message recorded with the change. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `measures` (v59+).

Output schema: `mb schema measure archive --output`.

Examples:

```sh
mb measure archive 1
mb measure archive 1 --revision-message "deprecated"
```
