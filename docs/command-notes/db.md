## Walk a database from tables to fields

Start with [`mb db get <db-id> --include tables`](#mb-db-get), the compact table map. Pick the relevant tables, then fetch their fields one table at a time with [`mb table fields <table-id>`](table.md#mb-table-fields). When the answer outgrows the `--max-bytes` cap, the error names the next command down the ladder.

On a warehouse with hundreds of tables, traverse by schema ([`mb db schemas <db-id>`](#mb-db-schemas), then [`mb db schema-tables <db-id> <schema>`](#mb-db-schema-tables)), or find tables by name with [`mb search <term> --models table --db-id <db-id>`](search.md).
