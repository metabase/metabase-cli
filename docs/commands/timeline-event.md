---
title: "mb timeline-event"
summary: "Manage events on Metabase timelines (list them with `mb timeline events`)."
---

# mb timeline-event

Manage events on Metabase timelines (list them with `mb timeline events`).

Every command on this page takes the [output](README.md#output-flags), [profile](README.md#profile-flags), and [connection](README.md#connection-flags) flags.

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

Examples:

```sh
mb timeline-event get 1
mb timeline-event get 1 --json
```

## mb timeline-event create

Create a timeline event from JSON.

The JSON body needs `name`, `timestamp` (ISO 8601), `timezone` (an IANA name such as `UTC` or `America/New_York`), `time_matters` (`true` when the time of day matters, `false` when only the date does) and `timeline_id`. Optional: `description` and `icon` (star|cake|mail|warning|bell|cloud, plus mail_at|info|note|event from Metabase v64; the timeline's icon by default).

```sh
mb timeline-event create [flags]
```

Also takes the [body](README.md#body-flags) flags.

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

Also takes the [body](README.md#body-flags) flags.

Examples:

```sh
mb timeline-event update 1 --body '{"name":"v2.1 launch"}'
cat patch.json | mb timeline-event update 1
mb timeline-event update 1 --file patch.json
```

## mb timeline-event archive

Archive (soft-delete) a timeline event by id.

To restore the event, run `mb timeline-event update <id> --body '{"archived":false}'`.

```sh
mb timeline-event archive <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Timeline event id. |

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

| Argument or flag | Description |
| --- | --- |
| `<id>` | Timeline event id. |
| `--yes` | Skip confirmation. |

Examples:

```sh
mb timeline-event delete 1 --yes
mb timeline-event delete 1
```
