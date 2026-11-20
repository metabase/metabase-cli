---
title: "mb snippet"
summary: "Manage Metabase native query snippets."
---

# mb snippet

Manage Metabase native query snippets.

Agent skills:

- `mb skills get core`: native-SQL snippets and body input

## mb snippet list

List native query snippets.

```sh
mb snippet list [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--archived` |  | Show archived snippets instead of active ones. |

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema snippet list --output`.

Examples:

```sh
mb snippet list
mb snippet list --json
mb snippet list --archived --json
```

## mb snippet get

Get a native query snippet by id.

```sh
mb snippet get <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Snippet id. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema snippet get --output`.

Examples:

```sh
mb snippet get 1
mb snippet get 1 --json
```

## mb snippet create

Create a native query snippet from a JSON spec.

```sh
mb snippet create [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Body schema: `mb schema snippet create`. Output schema: `mb schema snippet create --output`.

Examples:

```sh
cat snippet.json | mb snippet create
mb snippet create --file snippet.json
mb snippet create --body '{"name":"active","content":"WHERE active = true"}'
```

## mb snippet update

Update a native query snippet by id.

```sh
mb snippet update <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Snippet id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Body schema: `mb schema snippet update`. Output schema: `mb schema snippet update --output`.

Examples:

```sh
cat patch.json | mb snippet update 1
mb snippet update 1 --file patch.json
mb snippet update 1 --body '{"name":"renamed"}'
mb snippet update 1 --body '{"archived":true}'
```

## mb snippet archive

Archive (soft-delete) a native query snippet by id.

```sh
mb snippet archive <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Snippet id. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema snippet archive --output`.

Examples:

```sh
mb snippet archive 1
mb snippet archive 1 --json
```
