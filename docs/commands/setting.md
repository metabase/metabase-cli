---
title: "mb setting"
summary: "Inspect and update Metabase settings."
---

# mb setting

Inspect and update Metabase settings.

Agent skills:

- `mb skills get core`: setting get/set JSON value quoting

## Access

[mb setting get](#mb-setting-get) and [mb setting set](#mb-setting-set) work on one key, and the server judges each call by that setting's own access rules.

## mb setting list

List all settings (admin).

The full rows, with each setting's `description` and `default`, can go over the default output cap; `--max-bytes 0` lifts it.

```sh
mb setting list [flags]
```

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema setting list --output`.

Examples:

```sh
mb setting list
mb setting list --json
mb setting list --full --json --max-bytes 0
```

## mb setting get

Get a setting value by key.

Returns `{ key, value }`. `value` is `null` for a setting at its default, and for one set by an environment variable.

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

Pass `'"main"'` for the string `main`, `true` or `42` for a boolean or a number, and `null` to delete the stored value, which resets the setting to its default. Give the value once: as the positional, with `--file`, or on stdin; a positional together with `--file` is refused. A value that isn't JSON, or no value at all, is refused before any request (exit 2).

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
