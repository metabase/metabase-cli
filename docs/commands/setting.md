---
title: "mb setting"
summary: "Inspect and update Metabase settings."
---

# mb setting

Inspect and update Metabase settings.

Agent skills:

- `mb skills get core`: setting get/set JSON value quoting

## mb setting list

List all settings (admin).

```sh
mb setting list [flags]
```

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema setting list --output`.

Examples:

```sh
mb setting list
mb setting list --json
```

## mb setting get

Get a setting value by key.

```sh
mb setting get <key> [flags]
```

| Argument | Description |
| --- | --- |
| `<key>` | Setting key. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema setting get --output`.

Examples:

```sh
mb setting get remote-sync-branch
mb setting get site-name --json
```

## mb setting set

Set a setting value (parsed strictly as JSON).

```sh
mb setting set <key> [value] [flags]
```

| Argument | Description |
| --- | --- |
| `<key>` | Setting key. |
| `[value]` | JSON-encoded value. |

| Flag | Default | Description |
| --- | --- | --- |
| `--file <value>` |  | Path to a file containing the JSON value. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Body schema: `mb schema setting set`. Output schema: `mb schema setting set --output`.

Examples:

```sh
mb setting set remote-sync-branch '"main"'
mb setting set anon-tracking-enabled true
echo '"main"' | mb setting set remote-sync-branch
mb setting set remote-sync-branch --file value.json
mb setting set remote-sync-branch null
```
