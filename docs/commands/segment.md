---
title: "mb segment"
summary: "Manage Metabase segments."
---

# mb segment

Manage Metabase segments.

Every command on this page takes the [output](README.md#output-flags), [profile](README.md#profile-flags), and [connection](README.md#connection-flags) flags.

Agent skills:

- `mb skills get mbql`: the definition filter clause
- `mb skills get data-workflow`: define reusable segments

## mb segment list

List segments.

```sh
mb segment list [flags]
```

Also takes the [list](README.md#list-flags) flags.

Examples:

```sh
mb segment list
mb segment list --json
```

## mb segment get

Get a segment by id.

```sh
mb segment get <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Segment id. |

Examples:

```sh
mb segment get 1
mb segment get 1 --json
```

## mb segment create

Create a segment (saved filter) from JSON.

A segment is a saved row filter on a table, which cards reuse in their filters. The JSON body needs `name`, `table_id` and a `definition` (an MBQL query holding the filter). An MBQL 5 `definition` is checked against the bundled schema (`mb schema query`) before it's sent.

```sh
mb segment create [flags]
```

| Flag | Description |
| --- | --- |
| `--skip-validate` | Skip the local MBQL 5 pre-flight validation; let the server be the authority. Use only when the bundled schema disagrees with what the server accepts. |

Also takes the [body](README.md#body-flags) flags.

Agent skills:

- `mb skills get mbql`: the definition filter clause

Examples:

```sh
cat segment.json | mb segment create
mb segment create --file segment.json
mb segment create --file segment.json --skip-validate
```

## mb segment update

Update a segment by id (body must include revision_message).

Patches only the fields you send, and needs a `revision_message` for the audit log. A new MBQL 5 `definition` is checked against the bundled schema (`mb schema query`) before it's sent.

```sh
mb segment update <id> [flags]
```

| Argument or flag | Description |
| --- | --- |
| `<id>` | Segment id. |
| `--skip-validate` | Skip the local MBQL 5 pre-flight validation; let the server be the authority. Use only when the bundled schema disagrees with what the server accepts. |

Also takes the [body](README.md#body-flags) flags.

Agent skills:

- `mb skills get mbql`: the definition filter clause

Examples:

```sh
cat patch.json | mb segment update 1
mb segment update 1 --file patch.json
mb segment update 1 --body '{"name":"renamed","revision_message":"rename"}'
mb segment update 1 --file patch.json --skip-validate
```

## mb segment archive

Archive (soft-delete) a segment by id.

```sh
mb segment archive <id> [flags]
```

| Argument or flag | Description |
| --- | --- |
| `<id>` | Segment id. |
| `--revision-message <value>` | Audit-log message recorded with the change. Default: `Archived via mb CLI`. |

Examples:

```sh
mb segment archive 1
mb segment archive 1 --revision-message "deprecated"
```
