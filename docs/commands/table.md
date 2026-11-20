---
title: "mb table"
summary: "Manage Metabase tables."
---

# mb table

Manage Metabase tables.

Agent skills:

- `mb skills get metadata`: table and column metadata, semantic types, visibility

## Publish status

A table's publish status shows on the table itself: [`mb table get`](#mb-table-get) and [`mb table list`](#mb-table-list) carry `is_published`, and `collection_id` under `--full`. [`mb library publish`](library.md#mb-library-publish) publishes tables to the Library.

## Some update values are refused before the request

A server without `tableUserValueWithdrawal` writes `data_authority: null` into a column that takes no `null`: the update fails with a bare 500, or stores something other than a withdrawal. A server with `tableDataLayerTiers` names its layers `final`, `internal` and `hidden`, and maps a medallion `data_layer` onto one of them. So [`mb table update`](#mb-table-update) refuses both values before it sends the request (exit 2).

## A move to a collection can fail in part

Whether an update moves a table to `collection_id` depends on the server's patch release, so `mb table update` checks the table that the server returns. A server that drops the key applies the rest of the update and leaves the table where it was. The command then reports a `partial-write` error (exit 1) that names the collection the table stayed in.

## mb table list

List tables, optionally filtered.

Returns a flat compact list without fields; when you know the schema, `mb db schema-tables <db-id> <schema>` is the better starting point. `--db-id` narrows the list on the client; every other filter is applied by the server. `--unused-only`, `--published-only`, `--can-query`, `--can-write` and `--include-transform-targets` are refused before the request (exit 2) on a server without the feature the flag needs, because such a server drops a filter it doesn't know without a word.

```sh
mb table list [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--db-id <value>` |  | Filter by database id. |
| `--term <value>` |  | Match table names and display names by prefix, and display names by the start of any word too (`ite` matches Order Items); `*` is a wildcard. |
| `--visibility-type <value>` |  | Only tables with this visibility: hidden\|technical\|cruft. |
| `--data-layer <value>` |  | Only tables in this data layer: final\|internal\|hidden; a server without `tableDataLayerTiers` (v59+) names them gold\|silver\|bronze\|copper. |
| `--data-source <value>` |  | Only tables from this data source: unknown\|ingested\|metabase-transform\|transform\|source-data\|upload. |
| `--owner-user-id <value>` |  | Only tables owned by this user id. |
| `--owner-email <value>` |  | Only tables owned by this email. |
| `--orphan-only` |  | Only tables with no owner. |
| `--unused-only` |  | Only tables nothing depends on; needs `tableUnusedFilter` (token dependencies). |
| `--published-only` |  | Only tables published to the library; needs `tableListPublishedFilter` (v63+). |
| `--can-query` |  | Only tables you can run queries against; needs `tableListAccessFilters` (v59+). |
| `--can-write` |  | Only tables whose metadata you can edit; needs `tableListAccessFilters` (v59+). |
| `--include-transform-targets` |  | Also list the inactive tables a transform writes to, which carry `active: false`; needs `tableListTransformTargets` (v60+). |

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

Without `--include`, returns the table record without its fields. `--include fields` reads the table's query metadata, so the result carries its columns compact-projected as `fields`, with each field's FK `target` and `dimensions` under `--full`: the default path for field introspection. `mb table fields <id>` returns the fields alone, as a list envelope.

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

Lists every active field whose `fk_target_field_id` is an active, unretired field of this table, the table's own self-references included. The server leaves out origin fields in inactive tables and in tables the caller can't read, so a non-admin sees only the foreign keys from tables they can read. Each row carries the origin field with its table (`id`, `name`, `display_name`, `schema`, `db_id`), the destination field, and the relationship (`Mt1`); the text table names the origin as `<schema>.<table>.<field>`, or `<table>.<field>` on a database without schemas. A table nothing points at returns an empty list.

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

`display_name`, `entity_type`, `show_in_getting_started`, `field_order` and `collection_id` take no `null`: the server would drop it and keep the old value. Two values are refused before the request (exit 2), because a server would take them without doing what they ask: `data_authority: null` on a server without `tableUserValueWithdrawal` (v64+), and a medallion `data_layer` (`gold`, `silver`, `bronze`, `copper`) on a server with `tableDataLayerTiers` (v59+). When the server drops `collection_id`, the command exits 1 with a `partial-write` error.

```sh
mb table update <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Table id. |

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file, or `-` to read stdin. |

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

Queues an async sync of this one table and returns `{ id, status: "ok" }` immediately; the server reports no completion to wait on. The sync re-reads the table's columns, fingerprints them, and refreshes its cached field values; it never discovers new tables, so use `mb db sync-schema <db-id>` for a table the warehouse just gained. A warehouse the server can't connect to is refused with a 422. To sync a set of tables use `mb table bulk-sync-schema`.

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

Deletes the cached distinct values behind this table's filter dropdowns, and with them any custom display values set on those values. No scan recreates a discarded set, neither `mb table rescan-values` nor the database's scheduled scan; Metabase rebuilds a set, without its display values, the next time it is read (a filter dropdown, `mb field values <id>`). Asks for confirmation on a terminal; pass `--yes` to skip it, which a non-interactive run must. Returns `{ id, discarded, aborted }`. To discard a set of tables use `mb table bulk-discard-values`.

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

The body selects tables with any of `table_ids`, `database_ids`, and `schema_ids` (each schema ID is `<db-id>:<schema>`, e.g. `1:public`; the selectors are unioned) and sets any of `data_authority`, `data_source`, `data_layer`, `entity_type`, `owner_email`, `owner_user_id` on all of them. A configured `data_authority` can't be set back to `unconfigured`, and `data_source` never moves to or from `metabase-transform`. A selected table that breaks either rule fails the call: on a server without `tableUserValueWithdrawal` (v64+) no table is edited, while on one with it the selected tables Metabase held no user edits for may already carry the new values. Without `tableUserValueWithdrawal`, `null` clears a field, `null` for `data_authority` is refused before any request (exit 2), and the next scheduled analysis overwrites `entity_type` with the type it derives from the table name. With it, `null` withdraws the edit: `data_source` and `data_layer` read back empty, while `entity_type`, `owner_email`, `owner_user_id`, and `data_authority` fall back to the values Metabase keeps for the table, which are the name-derived entity type and the owner and data authority from before the upgrade (no owner and `unconfigured` for a table published then or created since). A table leaving the `hidden` data layer is re-synced after the call returns. A body that selects nothing or sets nothing is refused before any request. The server responds the same whether or not a selector matched a table, so the output restates the accepted request as `{ accepted: true, ...body }` and can't say which tables were edited. An older server serves a similar edit only on Enterprise, at another path and with the medallion layer names; the command doesn't reach it.

```sh
mb table bulk-edit [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--body <value>` |  | Inline JSON body. |
| `--file <value>` |  | Path to JSON body file, or `-` to read stdin. |

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

Queues an async sync of every selected table and returns immediately; each sync re-reads the table's columns, fingerprints them, and refreshes its cached field values, and none discovers new tables (`mb db sync-schema <db-id>` does). Every database behind the selection must pass a connection test first, or the call is refused with a 422. Select with `--table-ids`, `--db-ids`, or `--schemas` (each schema ID is `<db-id>:<schema>` with a positive database ID, e.g. `1:public`, and `1:` selects the tables of database 1 that have no schema); the selectors are unioned. Only an admin or a data analyst can call it; anyone else gets a 403. The server responds the same whether or not a selector matched a table, so the output restates the accepted request, as `{ accepted: true, schema_ids: ["1:public"] }`, and can't say which tables were affected.

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

Queues an async rescan of the distinct values behind the filter dropdowns of every selected table and returns immediately. Only the sets already cached and read in the last 14 days are refreshed; a set never read, discarded, or unread for longer is skipped until a read rebuilds or revives it. Select with `--table-ids`, `--db-ids`, or `--schemas` (each schema ID is `<db-id>:<schema>` with a positive database ID, e.g. `1:public`, and `1:` selects the tables of database 1 that have no schema); the selectors are unioned. Only an admin or a data analyst can call it; anyone else gets a 403. The server responds the same whether or not a selector matched a table, so the output restates the accepted request, as `{ accepted: true, schema_ids: ["1:public"] }`, and can't say which tables were affected.

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

Deletes the cached distinct values behind the filter dropdowns of every selected table, and with them any custom display values set on those values. No scan recreates a discarded set, neither `mb table bulk-rescan-values` nor the database's scheduled scan; Metabase rebuilds a set, without its display values, the next time it is read (a filter dropdown, `mb field values <id>`). Asks for confirmation on a terminal; pass `--yes` to skip it, which a non-interactive run must. Select with `--table-ids`, `--db-ids`, or `--schemas` (each schema ID is `<db-id>:<schema>` with a positive database ID, e.g. `1:public`, and `1:` selects the tables of database 1 that have no schema); the selectors are unioned. Only an admin or a data analyst can call it; anyone else gets a 403. The server responds the same whether or not a selector matched a table, so the output restates the accepted request, as `{ accepted: true, schema_ids: ["1:public"] }`, and can't say which tables were affected. The output adds `aborted`; a declined confirmation sends nothing and returns `accepted: false, aborted: true`.

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
