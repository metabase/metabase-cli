---
title: "mb segment"
summary: "Manage Metabase segments."
---

# mb segment

Manage Metabase segments.

Agent skills:

- `mb skills get mbql`: the definition filter clause
- `mb skills get data-workflow`: define reusable segments

## mb segment list

List segments.

```sh
mb segment list [flags]
```

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema segment list --output`.

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

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema segment get --output`.

Examples:

```sh
mb segment get 1
mb segment get 1 --json
```

## mb segment create

Create a segment (saved filter) from JSON.

A segment is a reusable, saved row filter tied to a table. The JSON body needs `name`, `table_id`, and a `definition` (an MBQL query holding the filter). An MBQL 5 `definition` is checked against a bundled JSON Schema (print it with `mb schema query`) before sending; pass --skip-validate to bypass.

```sh
mb segment create [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file. |
| `--skip-validate` |  | Skip the local MBQL 5 pre-flight validation; let the server be the authority. Use only when the bundled schema disagrees with what the server accepts. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Body schema: `mb schema segment create`. Output schema: `mb schema segment create --output`.

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

Patches only the fields you send and must include `revision_message` (recorded in the audit log). When `definition` is an MBQL 5 query it is checked against a bundled JSON Schema (print it with `mb schema query`) before sending; pass --skip-validate to bypass.

```sh
mb segment update <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Segment id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file. |
| `--skip-validate` |  | Skip the local MBQL 5 pre-flight validation; let the server be the authority. Use only when the bundled schema disagrees with what the server accepts. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Body schema: `mb schema segment update`. Output schema: `mb schema segment update --output`.

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

| Argument | Description |
| --- | --- |
| `<id>` | Segment id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--revision-message <value>` | `Archived via mb CLI` | Audit-log message recorded with the change. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema segment archive --output`.

Examples:

```sh
mb segment archive 1
mb segment archive 1 --revision-message "deprecated"
```
