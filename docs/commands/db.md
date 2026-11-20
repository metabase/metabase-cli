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

## Traversal ladder

Start with [`mb db get <db-id> --include tables`](#mb-db-get), the compact table map. Pick the relevant tables, then fetch their fields one table at a time with [`mb table fields <table-id>`](table.md#mb-table-fields). When the answer outgrows the `--max-bytes` cap, the error names the next command down the ladder.

On a warehouse with hundreds of tables, traverse by schema ([`mb db schemas <db-id>`](#mb-db-schemas), then [`mb db schema-tables <db-id> <schema>`](#mb-db-schema-tables)), or find tables by name with [`mb search <term> --models table --db-id <db-id>`](search.md).

## mb db list

List databases.

`--saved` adds the Saved Questions virtual database: id `-1337`, no `engine`, and under `--include tables` its tables are the saved questions, each with a `card__<id>` string id. To map one database, prefer `mb db get <id> --include tables`.

```sh
mb db list [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--include <value>` |  | Hydrate related entities: tables (each database with its compact table map). |
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

A schema with no tables is left out.

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

Answers the schema's tables sorted by display name, as compact rows without fields. For the columns of a table you need, use `mb table get <id> --include fields` or `mb table fields <id>`.

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

Queues an async schema sync and returns immediately, answering `{ id, status: "ok" }`. Pass --wait to poll the database until its initial_sync_status reports `complete` (a database that has already finished its initial sync returns at once); the answer then adds `initial_sync_status`. To wait for a specific newly-materialized transform table to register, prefer `mb transform run <id> --sync`.

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

Queues an async rescan and returns immediately, answering `{ id, status: "ok" }`.

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
| `<enabled>` | true to enable data actions, false to disable; any other value is refused before the request (exit 2). |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema db set-data-actions --output`.

Agent skills:

- `mb skills get data-action`: author and run data actions on the database

Examples:

```sh
mb db set-data-actions 2 true
mb db set-data-actions 2 false --json
```
