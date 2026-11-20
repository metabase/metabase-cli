---
title: "mb setting"
summary: "Inspect and update Metabase settings."
---

# mb setting

Inspect and update Metabase settings.

Every command on this page takes the [output](README.md#output-flags), [profile](README.md#profile-flags), and [connection](README.md#connection-flags) flags.

Agent skills:

- `mb skills get core`: setting get/set JSON value quoting

## Each setting has its own access rules

[mb setting get](#mb-setting-get) and [mb setting set](#mb-setting-set) work on one key, and the server judges each call by that setting's own access rules.

## mb setting list

List all settings (admin).

The full rows, with each setting's `description` and `default`, can go over the default output cap; `--max-bytes 0` lifts it.

```sh
mb setting list [flags]
```

Also takes the [list](README.md#list-flags) flags.

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

Examples:

```sh
mb setting get remote-sync-branch
mb setting get site-name --json
```

## mb setting set

Set a setting value (parsed strictly as JSON).

Pass `'"main"'` for the string `main`, `true` or `42` for a boolean or a number, and `null` to delete the stored value, which resets the setting to its default. Give the value once: as the positional, with `--file`, or on stdin. A value that isn't JSON, no value, or a positional together with `--file` is refused before any request (exit 2).

```sh
mb setting set <key> [value] [flags]
```

| Argument or flag | Description |
| --- | --- |
| `<key>` | Setting key. |
| `[value]` | JSON-encoded value. |
| `--file <value>` | Path to a file containing the JSON value. |

Examples:

```sh
mb setting set remote-sync-branch '"main"'
mb setting set anon-tracking-enabled true
echo '"main"' | mb setting set remote-sync-branch
mb setting set remote-sync-branch --file value.json
mb setting set remote-sync-branch null
```
