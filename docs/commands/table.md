---
title: "mb table"
summary: "Manage Metabase tables."
---

# mb table

Manage Metabase tables.

Every command on this page takes the [output](README.md#output-flags), [profile](README.md#profile-flags), and [connection](README.md#connection-flags) flags.

Agent skills:

- `mb skills get metadata`: table and column metadata, semantic types, visibility

## Publish status shows on the table

[`mb table get`](#mb-table-get) and [`mb table list`](#mb-table-list) carry a table's `is_published`, and its `collection_id` under `--full`. [`mb library publish`](library.md#mb-library-publish) publishes tables to the Library.

## A move to a collection can fail in part

Some patch releases ignore `collection_id`, so [`mb table update`](#mb-table-update) checks the table the server returns. If the table didn't move, the rest of the update still applies, and the command reports a `partial-write` error (exit 1) that names the collection the table stayed in.

## What `null` does in a bulk edit

On a server with `tableUserValueWithdrawal`, `null` in [`mb table bulk-edit`](#mb-table-bulk-edit) withdraws an edit. `data_source` and `data_layer` then read back empty, and `entity_type`, `owner_email`, `owner_user_id` and `data_authority` go back to the values Metabase keeps for the table: the entity type it derives from the table name, and the owner and data authority from before the upgrade (no owner and `unconfigured` for a table published then or created since). On an older server, `null` clears the field, and the next scheduled analysis overwrites `entity_type` with the name-derived type. A table that leaves the `hidden` data layer is synced again after the call returns.

## mb table list

List tables, optionally filtered.

Returns a flat, compact list without fields. When you know the schema, start with `mb db schema-tables <db-id> <schema>` instead. `--db-id` filters on the client, and the server applies the other filters. A filter that needs a feature is refused before the request (exit 2) on a server without it.

```sh
mb table list [flags]
```

| Flag | Description |
| --- | --- |
| `--db-id <value>` | Filter by database id. |
| `--term <value>` | Match table names and display names by prefix, and display names by the start of any word too (`ite` matches Order Items); `*` is a wildcard. |
| `--visibility-type <value>` | Only tables with this visibility: hidden\|technical\|cruft. |
| `--data-layer <value>` | Only tables in this data layer: final\|internal\|hidden; a server without `tableDataLayerTiers` (v59+) names them gold\|silver\|bronze\|copper. |
| `--data-source <value>` | Only tables from this data source: unknown\|ingested\|metabase-transform\|transform\|source-data\|upload. |
| `--owner-user-id <value>` | Only tables owned by this user id. |
| `--owner-email <value>` | Only tables owned by this email. |
| `--orphan-only` | Only tables with no owner. |
| `--unused-only` | Only tables nothing depends on; needs `tableUnusedFilter` (token dependencies). |
| `--published-only` | Only tables published to the library; needs `tableListPublishedFilter` (v63+). |
| `--can-query` | Only tables you can run queries against; needs `tableListAccessFilters` (v59+). |
| `--can-write` | Only tables whose metadata you can edit; needs `tableListAccessFilters` (v59+). |
| `--include-transform-targets` | Also list the inactive tables a transform writes to, which carry `active: false`; needs `tableListTransformTargets` (v60+). |

Also takes the [list](README.md#list-flags) flags.

Examples:

```sh
mb table list
mb table list --db-id 1 --json
mb table list --term order --can-query --json
mb table list --data-layer hidden --orphan-only --json
```

## mb table get

Get a table by id; pass --include fields to bundle hydrated fields.

Returns the table without its fields. `--include fields` adds its columns as `fields`, with each field's FK `target` and `dimensions` under `--full`: the usual way to inspect a table's fields. `mb table fields <id>` returns the fields alone, as a list.

```sh
mb table get <id> [flags]
```

| Argument or flag | Description |
| --- | --- |
| `<id>` | Table id. |
| `--include <value>` | Hydrate related entities: fields. |

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

Also takes the [list](README.md#list-flags) flags.

Examples:

```sh
mb table fields 42
mb table fields 42 --json
```

## mb table fks

List the foreign keys pointing at a table.

Lists the active fields that point at this table, its own self-references included. Each row carries the origin field and its table (`id`, `name`, `display_name`, `schema`, `db_id`), the destination field, and the relationship (`Mt1`). The server leaves out inactive tables and tables you can't read. A table nothing points at returns an empty list.

```sh
mb table fks <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Table id. |

Also takes the [list](README.md#list-flags) flags.

Examples:

```sh
mb table fks 42
mb table fks 42 --json
```

## mb table update

Update a table (display name, description, visibility, etc.).

Changes only the fields you send. `display_name`, `entity_type`, `show_in_getting_started`, `field_order` and `collection_id` don't take `null` (the server keeps the old value). Refused before the request (exit 2): `data_authority: null` on a server without `tableUserValueWithdrawal` (v64+), and a medallion `data_layer` (`gold`, `silver`, `bronze`, `copper`) on a server with `tableDataLayerTiers` (v59+). If the table doesn't move to `collection_id`, the command exits 1 with a `partial-write` error.

```sh
mb table update <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Table id. |

Also takes the [body](README.md#body-flags) flags.

Examples:

```sh
mb table update 42 --body '{"display_name":"Customers"}'
mb table update 42 --file patch.json
cat patch.json | mb table update 42
```

## mb table sync-schema

Trigger a manual schema sync for one table.

Queues a sync of this table, and returns `{ id, status: "ok" }` at once: the server reports no completion to wait on. The sync re-reads the table's columns, fingerprints them, and refreshes its cached field values; to find new tables, use `mb db sync-schema <db-id>`. Refused with a 422 when the server can't connect to the warehouse. For several tables, use `mb table bulk-sync-schema`.

```sh
mb table sync-schema <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Table id. |

Examples:

```sh
mb table sync-schema 42
mb table sync-schema 42 --json
```

## mb table rescan-values

Trigger a rescan of cached field values for one table.

Queues a rescan of this table's cached filter values, and returns the server's `success` at once. Only the sets that are cached and were read in the last 14 days are refreshed. For several tables, use `mb table bulk-rescan-values`.

```sh
mb table rescan-values <id> [flags]
```

| Argument | Description |
| --- | --- |
| `<id>` | Table id. |

Examples:

```sh
mb table rescan-values 42
mb table rescan-values 42 --json
```

## mb table discard-values

Discard the cached field values of one table.

Deletes this table's cached filter values, with their custom display values. No scan brings them back: Metabase rebuilds the values, without display values, the next time something reads them (a filter dropdown, or `mb field values <id>`). Pass `--yes` to skip the confirmation, which a non-interactive run must. Returns `{ id, discarded, aborted }`. For several tables, use `mb table bulk-discard-values`.

```sh
mb table discard-values <id> [flags]
```

| Argument or flag | Description |
| --- | --- |
| `<id>` | Table id. |
| `--yes` | Skip confirmation. |

Examples:

```sh
mb table discard-values 42 --yes
mb table discard-values 42
```

## mb table bulk-edit

Set the same metadata on every table a selector picks out.

The body picks tables with any of `table_ids`, `database_ids` and `schema_ids` (`<db-id>:<schema>`, such as `1:public`), and sets any of `data_authority`, `data_source`, `data_layer`, `entity_type`, `owner_email` and `owner_user_id` on all of them. A body that picks or sets nothing is refused before the request. A configured `data_authority` can't go back to `unconfigured`, and `data_source` can't move to or from `metabase-transform`: a table that breaks either rule fails the call, though on a server with `tableUserValueWithdrawal` (v64+) some tables may already have the new values. Without that feature, `null` for `data_authority` is refused (exit 2). The output restates the request as `{ accepted: true, ...body }`, since the server doesn't say which tables matched.

```sh
mb table bulk-edit [flags]
```

Also takes the [body](README.md#body-flags) flags.

Needs `bulkTableEdit` (v59+).

Examples:

```sh
mb table bulk-edit --body '{"table_ids":[42,43],"owner_email":"dba@example.com"}'
mb table bulk-edit --body '{"schema_ids":["1:public"],"data_layer":"final"}' --json
cat edit.json | mb table bulk-edit
```

## mb table bulk-sync-schema

Trigger a schema sync for every table a selector picks out.

Queues a sync of every selected table, and returns at once. Each sync re-reads the table's columns, fingerprints them, and refreshes its cached field values; to find new tables, use `mb db sync-schema <db-id>`. Refused with a 422 unless every database behind the selection passes a connection test. Select tables with `--table-ids`, `--db-ids` and `--schemas`; the command acts on all of them. Only admins and data analysts can run it (403 otherwise). The output restates the request, as `{ accepted: true, schema_ids: ["1:public"] }`, since the server doesn't say which tables matched.

```sh
mb table bulk-sync-schema [flags]
```

| Flag | Description |
| --- | --- |
| `--table-ids <value>` | Comma-separated table ids. |
| `--db-ids <value>` | Comma-separated database ids. |
| `--schemas <value>` | Comma-separated schema ids, each "&lt;db-id>:&lt;schema>" (e.g. 1:public; 1: for the tables with no schema). |

Needs `bulkTableSync` (v59+).

Examples:

```sh
mb table bulk-sync-schema --schemas 1:public
mb table bulk-sync-schema --table-ids 42,43 --json
```

## mb table bulk-rescan-values

Trigger a rescan of cached field values for every table a selector picks out.

Queues a rescan of the cached filter values of every selected table, and returns at once. Only the sets that are cached and were read in the last 14 days are refreshed. Select tables with `--table-ids`, `--db-ids` and `--schemas`; the command acts on all of them. Only admins and data analysts can run it (403 otherwise). The output restates the request, as `{ accepted: true, schema_ids: ["1:public"] }`, since the server doesn't say which tables matched.

```sh
mb table bulk-rescan-values [flags]
```

| Flag | Description |
| --- | --- |
| `--table-ids <value>` | Comma-separated table ids. |
| `--db-ids <value>` | Comma-separated database ids. |
| `--schemas <value>` | Comma-separated schema ids, each "&lt;db-id>:&lt;schema>" (e.g. 1:public; 1: for the tables with no schema). |

Needs `bulkTableSync` (v59+).

Examples:

```sh
mb table bulk-rescan-values --db-ids 1
mb table bulk-rescan-values --schemas 1:public --json
```

## mb table bulk-discard-values

Discard the cached field values of every table a selector picks out.

Deletes the cached filter values of every selected table, with their custom display values. No scan brings them back: Metabase rebuilds the values, without display values, the next time something reads them. Pass `--yes` to skip the confirmation, which a non-interactive run must; a declined confirmation sends nothing and returns `accepted: false, aborted: true`. Select tables with `--table-ids`, `--db-ids` and `--schemas`; the command acts on all of them. Only admins and data analysts can run it (403 otherwise). The output restates the request, as `{ accepted: true, schema_ids: ["1:public"] }`, since the server doesn't say which tables matched.

```sh
mb table bulk-discard-values [flags]
```

| Flag | Description |
| --- | --- |
| `--table-ids <value>` | Comma-separated table ids. |
| `--db-ids <value>` | Comma-separated database ids. |
| `--schemas <value>` | Comma-separated schema ids, each "&lt;db-id>:&lt;schema>" (e.g. 1:public; 1: for the tables with no schema). |
| `--yes` | Skip confirmation. |

Needs `bulkTableSync` (v59+).

Examples:

```sh
mb table bulk-discard-values --table-ids 42,43 --yes
mb table bulk-discard-values --schemas 1:staging --yes --json
```
