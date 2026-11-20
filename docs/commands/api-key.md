---
title: "mb api-key"
summary: "Manage Metabase API keys."
---

# mb api-key

Manage Metabase API keys.

## mb api-key list

List API keys.

Only admins list API keys. Each shows its masked key; the key itself is never returned again after creation.

```sh
mb api-key list [flags]
```

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema api-key list --output`.

Examples:

```sh
mb api-key list
mb api-key list --json
```

## mb api-key create

Create an API key acting as a member of a group.

Only admins can create API keys. The JSON body needs `name` and `group_id` (`2` is Administrators). The key is printed once, as `unmasked_key` under `--json`, and no later read returns it: store it where it's needed and never paste it into chat.

```sh
mb api-key create [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file, or `-` to read stdin. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Body schema: `mb schema api-key create`. Output schema: `mb schema api-key create --output`.

Examples:

```sh
mb api-key create --body '{"name":"ci","group_id":2}' --json
```

## mb api-key delete

Delete an API key by id.

Only admins can delete API keys. Any request that uses the key fails after that.

```sh
mb api-key delete <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | API key id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--yes` | `false` | Skip confirmation. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema api-key delete --output`.

Examples:

```sh
mb api-key delete 3 --yes
```
