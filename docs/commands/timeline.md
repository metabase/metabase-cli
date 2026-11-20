---
title: "mb timeline"
summary: "Manage Metabase timelines (event annotations for time-series charts)."
---

# mb timeline

Manage Metabase timelines (event annotations for time-series charts).

Agent skills:

- `mb skills get core`: collection scoping — events render only on questions in the timeline's collection

## mb timeline list

List timelines.

```sh
mb timeline list [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--archived` |  | Show archived timelines instead of active ones. |

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema timeline list --output`.

Examples:

```sh
mb timeline list
mb timeline list --json
mb timeline list --archived --json
```

## mb timeline get

Get a timeline by id.

```sh
mb timeline get <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Timeline id. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema timeline get --output`.

Examples:

```sh
mb timeline get 1
mb timeline get 1 --json
```

## mb timeline events

List events on a timeline.

```sh
mb timeline events <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Timeline id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--archived` |  | Include archived events. |

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema timeline events --output`.

Examples:

```sh
mb timeline events 1
mb timeline events 1 --archived --json
```

## mb timeline create

Create a timeline from JSON.

The JSON body needs `name`; optional fields: `description`, `icon` (star|cake|mail|warning|bell|cloud, default star), `collection_id` (null = root collection), `default`.

```sh
mb timeline create [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Body schema: `mb schema timeline create`. Output schema: `mb schema timeline create --output`.

Examples:

```sh
mb timeline create --body '{"name":"Releases"}'
cat timeline.json | mb timeline create
mb timeline create --file timeline.json
```

## mb timeline update

Update a timeline by id.

Patches only the fields you send: `name`, `description`, `icon`, `collection_id`, `default`, `archived`. Changing `archived` cascades to every event on the timeline.

```sh
mb timeline update <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Timeline id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Body schema: `mb schema timeline update`. Output schema: `mb schema timeline update --output`.

Examples:

```sh
mb timeline update 1 --body '{"name":"Product releases"}'
cat patch.json | mb timeline update 1
mb timeline update 1 --file patch.json
```

## mb timeline archive

Archive (soft-delete) a timeline and all its events by id.

```sh
mb timeline archive <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Timeline id. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema timeline archive --output`.

Examples:

```sh
mb timeline archive 1
mb timeline archive 1 --json
```

## mb timeline delete

Permanently delete a timeline and all its events by id.

```sh
mb timeline delete <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Timeline id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--yes` | `false` | Skip confirmation. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema timeline delete --output`.

Examples:

```sh
mb timeline delete 1 --yes
mb timeline delete 1
```
