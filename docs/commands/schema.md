---
title: "mb schema"
summary: "Print the schema of a command's JSON body or output."
---

# mb schema

Print the schema of a command's JSON body or output.

Names another command and prints the JSON Schema of the JSON body it accepts, or with --output of the JSON it prints. A body field only some servers take says in its description the feature it needs, as `needs fieldDataSensitivity (v64+)`. Those notes are judged against the server the profile last probed, read from its cache with no request: `this server lacks it` follows a field that server lacks the feature for, which the client refuses there, `this server reads it differently` a value it would take as another, and `this server ignores it` a field it drops unread. A field holding an MBQL 5 query names `mb schema query`, which prints the MBQL 5 query schema that query, card, transform, segment, measure and data-action bodies are checked against.

```sh
mb schema <command> [subcommand] [flags]
```

| Argument | Description |
| --- | --- |
| `<command>` | The command, or the group holding it (card, query, …). |
| `[subcommand]` | The command within that group (create, get, …). |

| Flag | Default | Description |
| --- | --- | --- |
| `--url <value>` |  | Metabase URL. |
| `--output` |  | Print the schema of the command's output instead of its body. |

Shared flags: [format](README.md#format-flags), [profile](README.md#profile-flags).

Output schema: `mb schema schema --output`.

Examples:

```sh
mb schema card create
mb schema dashboard get --output
mb schema query
```
