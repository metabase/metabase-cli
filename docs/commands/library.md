---
title: "mb library"
summary: "Curate the Metabase Library — publish trusted tables to its Data collection."
---

# mb library

Curate the Metabase Library — publish trusted tables to its Data collection.

Agent skills:

- `mb skills get core`: publish tables to the Library
- `mb skills get data-workflow`: which tables are worth publishing

## mb library get

Show the Library and its Data / Metrics collection ids.

Reads the Library root and its child collections. Use the `library-data` child's id as the target for publishing tables (or just run `mb library publish`, which resolves it for you).

```sh
mb library get [flags]
```

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `library` (v59+, token library).

Output schema: `mb schema library get --output`.

Examples:

```sh
mb library get
mb library get --json
```

## mb library create

Create the Library (Data + Metrics collections); idempotent.

Creates the Library subtree if it doesn't exist and returns it; a no-op that returns the existing Library when it's already there. Only admins and data analysts can curate the Library.

```sh
mb library create [flags]
```

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `library` (v59+, token library).

Output schema: `mb schema library create --output`.

Examples:

```sh
mb library create
mb library create --json
```

## mb library publish

Publish tables (and their upstream dependencies) to the Library Data collection.

Sets each selected table and every upstream table it depends on into the Library Data collection, so they appear first in data pickers and rank up in search. The Library Data collection is resolved automatically (and the Library is created if it doesn't exist yet). Select with --table-ids, --db-ids, or --schemas (each schema id is "&lt;db-id>:&lt;schema>", e.g. 1:public); the filters are combined. Publishing does not add the Library to the git-sync scope — on an instance with remote sync configured, run `mb git-sync add-collection <library-id>` with the Library root's id, so exports carry the published tables' metadata and the rest of the Library.

```sh
mb library publish [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--table-ids <value>` |  | Comma-separated table ids. |
| `--db-ids <value>` |  | Comma-separated database ids. |
| `--schemas <value>` |  | Comma-separated schema ids, each "&lt;db-id>:&lt;schema>" (e.g. 1:public; 1: for the tables with no schema). |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `library` (v59+, token library).

Output schema: `mb schema library publish --output`.

Examples:

```sh
mb library publish --table-ids 1,2,3
mb library publish --db-ids 1 --json
mb library publish --schemas 1:public,1:analytics
```

## mb library unpublish

Unpublish tables (and their downstream dependents) from the Library.

Clears the Library collection for each selected table and recursively for every downstream table that depends on it. Select with --table-ids, --db-ids, or --schemas (each schema id is "&lt;db-id>:&lt;schema>", e.g. 1:public); the filters are combined.

```sh
mb library unpublish [flags]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--table-ids <value>` |  | Comma-separated table ids. |
| `--db-ids <value>` |  | Comma-separated database ids. |
| `--schemas <value>` |  | Comma-separated schema ids, each "&lt;db-id>:&lt;schema>" (e.g. 1:public; 1: for the tables with no schema). |

Shared flags: [output](README.md#output-flags), [profile](README.md#profile-flags), [connection](README.md#connection-flags).

Needs: `library` (v59+, token library).

Output schema: `mb schema library unpublish --output`.

Examples:

```sh
mb library unpublish --table-ids 1,2,3
mb library unpublish --db-ids 1 --json
mb library unpublish --schemas 1:public,1:analytics
```
