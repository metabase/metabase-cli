## Publish status

A table's publish status shows on the table itself: [`mb table get`](#mb-table-get) and [`mb table list`](#mb-table-list) carry `is_published`, and `collection_id` under `--full`. [`mb library publish`](library.md#mb-library-publish) publishes tables to the Library.

## Some update values are refused before the request

A server without `tableUserValueWithdrawal` writes `data_authority: null` into a column that takes no `null`: the update fails with a bare 500, or stores something other than a withdrawal. A server with `tableDataLayerTiers` names its layers `final`, `internal` and `hidden`, and maps a medallion `data_layer` onto one of them. So [`mb table update`](#mb-table-update) refuses both values before it sends the request (exit 2).

## A move to a collection can fail in part

Whether an update moves a table to `collection_id` depends on the server's patch release, so `mb table update` checks the table that the server returns. A server that drops the key applies the rest of the update and leaves the table where it was. The command then reports a `partial-write` error (exit 1) that names the collection the table stayed in.
