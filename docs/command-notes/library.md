## The Library

The Library is a governed subtree of collections under a `library` root. Its `library-data` collection, "Data", holds published tables, which steer everyone toward trusted, analysis-ready data, and its `library-metrics` collection, "Metrics", holds official metrics.

Curating the Library takes an admin or a data analyst: Curate permission on a collection is not enough to publish tables. A table's `is_published` field, in [mb table get](table.md#mb-table-get) and [mb table list](table.md#mb-table-list), says whether it is published.
