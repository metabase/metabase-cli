## What a schema holds

The schema is JSON Schema (draft 2020-12), printed as JSON only: `--format text` is refused. A command path resolves aliases as the command line does.

A defaulted body field isn't `required`. A schema that recurs across commands, such as a dashboard parameter, is declared once under `$defs`. A tuple keeps its arity (`minItems`, and `items: false` when it takes no more), and a rule that JSON Schema can't express is noted in the `description` as `refined: <message>`.

## Feature notes on a body

A note can name the values or the state it applies to: `needs tableUserValueWithdrawal (v64+) for null`, `needs dashboardSubscriptionFilters (token dashboard_subscription_filters) when non-empty`. A value that some servers take as something else reads `read differently under tableDataLayerTiers (v59+) for "gold", …`, and a field they drop unread reads `dropped by tableFromDefinition (v64+)`.

Without a cached probe for the server (the profile has none, or `--url` names another server), the notes have no verdict. Either way, the server decides what it accepts. An output schema has no feature notes.

A field holding a query the CLI checks names the check in its `description`: ``MBQL 5 query checked against `mb schema query` ``.

## The query schema

`mb schema query` prints the MBQL 5 query schema as a bundle, `{ schema, defs }`, whose `$ref`s point into `defs` by file name (`id.yaml`, `ref.yaml`, …). To validate with a validator such as Ajv, call `addSchema(defs[name], name)` for each file, then `compile(schema)`. [`mb query`](query.md#the-mbql-5-pre-flight) describes the check.

## Exit codes

`0` on success. `2` when the path names no command, or a group (the error lists its commands); when the command has no body schema, or with `--output` no output schema; or with `--format text`.
