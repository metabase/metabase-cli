---
title: "mb schema"
summary: "Print the schema of a command's JSON body or output."
---

# mb schema

Print the schema of a command's JSON body or output.

## What a schema holds

The schema is JSON Schema (draft 2020-12), and the output is JSON only: `--format text` is refused. A command path resolves aliases as the command line does.

A body is read as input, so a defaulted field is not `required`. A schema that recurs across commands, such as a dashboard parameter, is declared once under `$defs`, keyed by the client's name for it. A tuple keeps its arity (`minItems`, and `items: false` when it takes no more), and a refinement JSON Schema cannot express is noted in the `description` as `refined: <message>`.

## Feature notes on a body

A note can name the values or the state it applies to: `needs tableUserValueWithdrawal (v64+) for null`, `needs dashboardSubscriptionFilters (token dashboard_subscription_filters) when non-empty`. A value that a server holding a feature takes as something else reads `read differently under tableDataLayerTiers (v59+) for "gold", …`, and a field such a server drops unread `dropped by tableFromDefinition (v64+)`.

With no cached probe, or with `--url` naming a server the profile was not probed against, the notes stand alone, with no verdict for this server. The server still decides what it accepts. An output schema carries no feature notes.

A field holding a query the CLI checks names the check in its `description`: ``MBQL 5 query checked against `mb schema query` ``.

## The query schema

`mb schema query` prints the MBQL 5 query schema as the bundle `{ schema, defs: { "id.yaml", "parameter.yaml", "ref.yaml", "temporal_bucketing.yaml" } }`. The query schema's `$ref`s point into `defs` by file name, so an agent can feed the bundle to a validator such as Ajv (`addSchema(defs["id.yaml"], "id.yaml")` for each, then `compile(schema)`) or read it as documentation. [`mb query`](query.md#the-mbql-5-pre-flight) describes the check.

## Exit codes

`0` on success. `2` when the path names no command; names a command group (the error lists its commands); names a command that takes no JSON body, without `--output`; names a command that declares no output schema, with `--output`; or under `--format text`.

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
| `--url <value>` |  | Metabase URL, including any subpath the instance is served under (https://example.com/metabase). |
| `--output` |  | Print the schema of the command's output instead of its body. |

Shared flags: [format](README.md#format-flags), [profile](README.md#profile-flags).

Output schema: `mb schema schema --output`.

Examples:

```sh
mb schema card create
mb schema dashboard get --output
mb schema query
```
