---
title: "mb timeline-event"
summary: "Manage events on Metabase timelines (list them with `mb timeline events`)."
---

# mb timeline-event

Manage events on Metabase timelines (list them with `mb timeline events`).

Agent skills:

- `mb skills get core`: required event fields and timeline collection scoping

## mb timeline-event get

Get a timeline event by id.

```sh
mb timeline-event get <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Timeline event id. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema timeline-event get --output`.

Examples:

```sh
mb timeline-event get 1
mb timeline-event get 1 --json
```

## mb timeline-event create

Create a timeline event from JSON.

The JSON body needs `name`, `timestamp` (ISO 8601), `timezone` (IANA name like UTC or America/New_York), `time_matters` (true when the time of day is significant, false when only the date is), and `timeline_id`; optional fields: `description`, `icon` (star|cake|mail|warning|bell|cloud, default: the timeline's icon).

```sh
mb timeline-event create [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Body schema: `mb schema timeline-event create`. Output schema: `mb schema timeline-event create --output`.

Examples:

```sh
mb timeline-event create --body '{"name":"v2 launch","timestamp":"2026-07-01T00:00:00Z","timezone":"UTC","time_matters":false,"timeline_id":1}'
cat event.json | mb timeline-event create
mb timeline-event create --file event.json
```

## mb timeline-event update

Update a timeline event by id.

Patches only the fields you send: `name`, `description`, `timestamp`, `timezone`, `time_matters`, `icon`, `timeline_id` (moves the event to another timeline), `archived`.

```sh
mb timeline-event update <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Timeline event id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Body schema: `mb schema timeline-event update`. Output schema: `mb schema timeline-event update --output`.

Examples:

```sh
mb timeline-event update 1 --body '{"name":"v2.1 launch"}'
cat patch.json | mb timeline-event update 1
mb timeline-event update 1 --file patch.json
```

## mb timeline-event archive

Archive (soft-delete) a timeline event by id.

```sh
mb timeline-event archive <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Timeline event id. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema timeline-event archive --output`.

Examples:

```sh
mb timeline-event archive 1
mb timeline-event archive 1 --json
```

## mb timeline-event delete

Permanently delete a timeline event by id.

```sh
mb timeline-event delete <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Timeline event id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--yes` | `false` | Skip confirmation. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema timeline-event delete --output`.

Examples:

```sh
mb timeline-event delete 1 --yes
mb timeline-event delete 1
```
