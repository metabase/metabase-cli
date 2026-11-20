## Publish status shows on the table

[`mb table get`](#mb-table-get) and [`mb table list`](#mb-table-list) carry a table's `is_published`, and its `collection_id` under `--full`. [`mb library publish`](library.md#mb-library-publish) publishes tables to the Library.

## A move to a collection can fail in part

Some patch releases ignore `collection_id`, so [`mb table update`](#mb-table-update) checks the table the server returns. If the table didn't move, the rest of the update still applies, and the command reports a `partial-write` error (exit 1) that names the collection the table stayed in.

## What `null` does in a bulk edit

On a server with `tableUserValueWithdrawal`, `null` in [`mb table bulk-edit`](#mb-table-bulk-edit) withdraws an edit. `data_source` and `data_layer` then read back empty, and `entity_type`, `owner_email`, `owner_user_id` and `data_authority` go back to the values Metabase keeps for the table: the entity type it derives from the table name, and the owner and data authority from before the upgrade (no owner and `unconfigured` for a table published then or created since). On an older server, `null` clears the field, and the next scheduled analysis overwrites `entity_type` with the name-derived type. A table that leaves the `hidden` data layer is synced again after the call returns.
