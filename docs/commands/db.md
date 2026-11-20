---
title: "mb db"
summary: "Inspect and sync Metabase databases, and turn their data actions on or off."
---

# mb db

Inspect and sync Metabase databases, and turn their data actions on or off.

Alias: `mb database`.

Agent skills:

- `mb skills get core`: the database traversal ladder and schema sync
- `mb skills get data-workflow`: model a raw database into clean tables

## mb db list

List databases.

```sh
mb db list [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--include <value>` |  | Hydrate related entities: tables. |
| `--saved` |  | Include the Saved Questions virtual database. |

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema db list --output`.

Examples:

```sh
mb db list
mb db list --json
mb db list --include tables --json
mb db list --saved --json
```

## mb db get

Get a database by id.

`--include tables` returns the table map (id, name, schema, description per table) — one call that fits most databases. `--include tables.fields` is the full rollup; on all but small databases prefer the map plus `mb table fields <table-id>` per table of interest.

```sh
mb db get <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Database id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--include <value>` |  | Hydrate related entities: tables\|tables.fields. tables is the compact table map; tables.fields adds every field — fine for small databases, use the map plus table fields &lt;id> for large ones. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema db get --output`.

Examples:

```sh
mb db get 1
mb db get 1 --json
mb db get 1 --include tables --json
mb db get 1 --include tables.fields --json
```

## mb db schemas

List schemas in a database.

```sh
mb db schemas <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Database id. |

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema db schemas --output`.

Examples:

```sh
mb db schemas 1
mb db schemas 1 --json
```

## mb db schema-tables

List tables in a database schema.

```sh
mb db schema-tables <id> <schema> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Database id. |
| `<schema>` | Schema name. |

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema db schema-tables --output`.

Examples:

```sh
mb db schema-tables 1 public
mb db schema-tables 1 public --json
```

## mb db sync-schema

Trigger a manual schema sync for a database.

Queues an async schema sync and returns immediately. Pass --wait to poll the database until its initial_sync_status reports `complete` (a database that has already finished its initial sync returns at once). To wait for a specific newly-materialized transform table to register, prefer `mb transform run <id> --sync`.

```sh
mb db sync-schema <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Database id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--wait` | `false` | Poll until the operation reaches a terminal state. |
| `--timeout <value>` | `600000` | Polling timeout in ms (used with --wait). |
| `--interval <value>` | `2000` | Polling interval in ms (used with --wait). |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema db sync-schema --output`.

Examples:

```sh
mb db sync-schema 1
mb db sync-schema 1 --wait --json
```

## mb db rescan-values

Trigger a rescan of cached field values for a database.

```sh
mb db rescan-values <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Database id. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema db rescan-values --output`.

Examples:

```sh
mb db rescan-values 1
mb db rescan-values 1 --json
```

## mb db set-data-actions

Enable or disable data actions for a database.

The Data actions toggle of Admin → Databases (the `database-enable-actions` database setting): while it is off, data actions on the database can be neither created nor run. Needs an admin. The driver must support writes: `mb db get <id> --full --json` lists `actions` in `features`. Answers the database with its `settings`.

```sh
mb db set-data-actions <id> <enabled> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Database id. |
| `<enabled>` | true to enable data actions, false to disable. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema db set-data-actions --output`.

Agent skills:

- `mb skills get data-action`: author and run data actions on the database

Examples:

```sh
mb db set-data-actions 2 true
mb db set-data-actions 2 false --json
```
