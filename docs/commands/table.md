---
title: "mb table"
summary: "Manage Metabase tables."
---

# mb table

Manage Metabase tables.

Agent skills:

- `mb skills get metadata`: table and column metadata, semantic types, visibility

## mb table list

List tables, optionally filtered.

```sh
mb table list [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--db-id <value>` |  | Filter by database id. |
| `--term <value>` |  | Match table names and display names by prefix (`*` is a wildcard). |
| `--visibility-type <value>` |  | Only tables with this visibility: hidden\|technical\|cruft. |
| `--data-layer <value>` |  | Only tables in this data layer: final\|internal\|hidden\|gold\|silver\|bronze\|copper. |
| `--data-source <value>` |  | Only tables from this data source: unknown\|ingested\|metabase-transform\|transform\|source-data\|upload. |
| `--owner-user-id <value>` |  | Only tables owned by this user id. |
| `--owner-email <value>` |  | Only tables owned by this email. |
| `--orphan-only` |  | Only tables with no owner. |
| `--unused-only` |  | Only tables nothing depends on (needs the dependencies feature). |
| `--published-only` |  | Only tables published to the library. |
| `--can-query` |  | Only tables you can run queries against. |
| `--can-write` |  | Only tables whose metadata you can edit. |
| `--include-transform-targets` |  | Also list the inactive tables a transform writes to. |

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema table list --output`.

Examples:

```sh
mb table list
mb table list --db-id 1 --json
mb table list --term order --can-query --json
mb table list --data-layer hidden --orphan-only --json
```

## mb table get

Get a table by id; pass --include fields to bundle hydrated fields.

```sh
mb table get <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Table id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--include <value>` |  | Hydrate related entities: fields. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema table get --output`.

Examples:

```sh
mb table get 42
mb table get 42 --json
mb table get 42 --include fields --json
```

## mb table fields

List fields on a table (projection over query_metadata.fields).

```sh
mb table fields <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Table id. |

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema table fields --output`.

Examples:

```sh
mb table fields 42
mb table fields 42 --json
```

## mb table fks

List the foreign keys pointing at a table.

Lists every active field whose `fk_target_field_id` is an active, unretired field of this table, the table's own self-references included. The server leaves out origin fields in inactive tables and in tables the caller cannot read, so a non-admin sees only the foreign keys from tables it can read. The text table names the origin as `<schema>.<table>.<field>`, or `<table>.<field>` on a database without schemas.

```sh
mb table fks <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Table id. |

Shared flags: [output](README.md#output-flags), [list](README.md#list-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema table fks --output`.

Examples:

```sh
mb table fks 42
mb table fks 42 --json
```

## mb table update

Update a table (display name, description, visibility, etc.).

```sh
mb table update <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Table id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Body schema: `mb schema table update`. Output schema: `mb schema table update --output`.

Examples:

```sh
mb table update 42 --body '{"display_name":"Customers"}'
mb table update 42 --file patch.json
cat patch.json | mb table update 42
```

## mb table sync-schema

Trigger a manual schema sync for one table.

Queues an async sync of this one table and returns immediately; the server reports no completion to wait on. The sync re-reads the table's columns, fingerprints them, and refreshes its cached field values; it never discovers new tables, so use `mb db sync-schema <db-id>` for a table the warehouse just gained. A warehouse the server cannot connect to is refused with a 422. To sync a set of tables use `mb table bulk-sync-schema`.

```sh
mb table sync-schema <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Table id. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema table sync-schema --output`.

Examples:

```sh
mb table sync-schema 42
mb table sync-schema 42 --json
```

## mb table rescan-values

Trigger a rescan of cached field values for one table.

Queues an async rescan of the distinct values behind this table's filter dropdowns and returns immediately with the server's `success` acknowledgement. Only the sets already cached and read in the last 14 days are refreshed; a set never read, discarded, or unread for longer is skipped until a read rebuilds or revives it. To rescan a set of tables use `mb table bulk-rescan-values`.

```sh
mb table rescan-values <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Table id. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema table rescan-values --output`.

Examples:

```sh
mb table rescan-values 42
mb table rescan-values 42 --json
```

## mb table discard-values

Discard the cached field values of one table.

Deletes the cached distinct values behind this table's filter dropdowns, and with them any custom display values set on those values. No scan recreates a discarded set, neither `mb table rescan-values` nor the database's scheduled scan; Metabase rebuilds a set, without its display values, the next time it is read (a filter dropdown, `mb field values <id>`). Asks for confirmation on a terminal; pass --yes to skip it, which a non-interactive run must. To discard a set of tables use `mb table bulk-discard-values`.

```sh
mb table discard-values <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Table id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--yes` | `false` | Skip confirmation. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Output schema: `mb schema table discard-values --output`.

Examples:

```sh
mb table discard-values 42 --yes
mb table discard-values 42
```

## mb table bulk-edit

Set the same metadata on every table a selector picks out.

The body selects tables with any of `table_ids`, `database_ids`, and `schema_ids` (each schema id is "&lt;db-id>:&lt;schema>", e.g. 1:public; the selectors are unioned) and sets any of `data_authority`, `data_source`, `data_layer`, `entity_type`, `owner_email`, `owner_user_id` on all of them. A configured `data_authority` cannot be set back to "unconfigured", and `data_source` never moves to or from "metabase-transform". A selected table that breaks either rule fails the call: before Metabase 64 no table is edited, while on 64 the selected tables Metabase held no user edits for may already carry the new values. Before Metabase 64, `null` clears a field, `null` for `data_authority` is refused before any request, and the next scheduled analysis overwrites `entity_type` with the type it derives from the table name. On Metabase 64, `null` withdraws the edit: `data_source` and `data_layer` read back empty, while `entity_type`, `owner_email`, `owner_user_id`, and `data_authority` fall back to the values Metabase keeps for the table, which are the name-derived entity type and the owner and data authority from before the upgrade (no owner and "unconfigured" for a table published then or created since). A table leaving the `hidden` data layer is re-synced after the call returns. The server answers the same whether or not a selector matched a table, so the output restates the accepted request and cannot say which tables were edited.

```sh
mb table bulk-edit [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `bulkTableEdit` (v59+).

Body schema: `mb schema table bulk-edit`. Output schema: `mb schema table bulk-edit --output`.

Examples:

```sh
mb table bulk-edit --body '{"table_ids":[42,43],"owner_email":"dba@example.com"}'
mb table bulk-edit --body '{"schema_ids":["1:public"],"data_layer":"final"}' --json
cat edit.json | mb table bulk-edit
```

## mb table bulk-sync-schema

Trigger a schema sync for every table a selector picks out.

Queues an async sync of every selected table and returns immediately; each sync re-reads the table's columns, fingerprints them, and refreshes its cached field values, and none discovers new tables (`mb db sync-schema <db-id>` does). Every database behind the selection must pass a connection test first, or the call is refused with a 422. Select with --table-ids, --db-ids, or --schemas (each schema id is "&lt;db-id>:&lt;schema>", e.g. 1:public, and 1: selects the tables of database 1 that have no schema); the selectors are unioned. Only an admin or a data analyst may call it; anyone else gets a 403. The server answers the same whether or not a selector matched a table, so the output restates the accepted request and cannot say which tables were affected.

```sh
mb table bulk-sync-schema [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--table-ids <value>` |  | Comma-separated table ids. |
| `--db-ids <value>` |  | Comma-separated database ids. |
| `--schemas <value>` |  | Comma-separated schema ids, each "&lt;db-id>:&lt;schema>" (e.g. 1:public; 1: for the tables with no schema). |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `bulkTableSync` (v59+).

Output schema: `mb schema table bulk-sync-schema --output`.

Examples:

```sh
mb table bulk-sync-schema --schemas 1:public
mb table bulk-sync-schema --table-ids 42,43 --json
```

## mb table bulk-rescan-values

Trigger a rescan of cached field values for every table a selector picks out.

Queues an async rescan of the distinct values behind the filter dropdowns of every selected table and returns immediately. Only the sets already cached and read in the last 14 days are refreshed; a set never read, discarded, or unread for longer is skipped until a read rebuilds or revives it. Select with --table-ids, --db-ids, or --schemas (each schema id is "&lt;db-id>:&lt;schema>", e.g. 1:public, and 1: selects the tables of database 1 that have no schema); the selectors are unioned. Only an admin or a data analyst may call it; anyone else gets a 403. The server answers the same whether or not a selector matched a table, so the output restates the accepted request and cannot say which tables were affected.

```sh
mb table bulk-rescan-values [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--table-ids <value>` |  | Comma-separated table ids. |
| `--db-ids <value>` |  | Comma-separated database ids. |
| `--schemas <value>` |  | Comma-separated schema ids, each "&lt;db-id>:&lt;schema>" (e.g. 1:public; 1: for the tables with no schema). |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `bulkTableSync` (v59+).

Output schema: `mb schema table bulk-rescan-values --output`.

Examples:

```sh
mb table bulk-rescan-values --db-ids 1
mb table bulk-rescan-values --schemas 1:public --json
```

## mb table bulk-discard-values

Discard the cached field values of every table a selector picks out.

Deletes the cached distinct values behind the filter dropdowns of every selected table, and with them any custom display values set on those values. No scan recreates a discarded set, neither `mb table bulk-rescan-values` nor the database's scheduled scan; Metabase rebuilds a set, without its display values, the next time it is read (a filter dropdown, `mb field values <id>`). Asks for confirmation on a terminal; pass --yes to skip it, which a non-interactive run must. Select with --table-ids, --db-ids, or --schemas (each schema id is "&lt;db-id>:&lt;schema>", e.g. 1:public, and 1: selects the tables of database 1 that have no schema); the selectors are unioned. Only an admin or a data analyst may call it; anyone else gets a 403. The server answers the same whether or not a selector matched a table, so the output restates the accepted request and cannot say which tables were affected.

```sh
mb table bulk-discard-values [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--table-ids <value>` |  | Comma-separated table ids. |
| `--db-ids <value>` |  | Comma-separated database ids. |
| `--schemas <value>` |  | Comma-separated schema ids, each "&lt;db-id>:&lt;schema>" (e.g. 1:public; 1: for the tables with no schema). |
| `--yes` | `false` | Skip confirmation. |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `bulkTableSync` (v59+).

Output schema: `mb schema table bulk-discard-values --output`.

Examples:

```sh
mb table bulk-discard-values --table-ids 42,43 --yes
mb table bulk-discard-values --schemas 1:staging --yes --json
```
