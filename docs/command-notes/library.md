## The Library holds trusted tables and metrics

The Library is a governed subtree of collections under a `library` root. Its `library-data` collection, "Data", holds published tables, and its `library-metrics` collection, "Metrics", holds official metrics.

Only admins and data analysts can curate the Library: Curate permission on a collection isn't enough to publish tables. A table's `is_published` field, in [mb table get](table.md#mb-table-get) and [mb table list](table.md#mb-table-list), says whether it is published.
