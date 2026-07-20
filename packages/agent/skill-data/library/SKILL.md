---
name: library
description: Curate the Metabase Library — the instance's shortlist of trusted data. What publishing a table actually does (first in data pickers, ranked up in search), the Data / Metrics split, the dependency cascades (publish carries upstream sources, unpublish carries downstream dependents), who is allowed to publish, which tables deserve it, and how published tables interact with git-sync. Load when the user says "publish this table", "make this the official table", "mark these as trusted", "why is nobody using my clean tables", "what's in the Library", "unpublish", or "curate the data".
---

# The Library

Most Metabase instances have a discovery problem, not a data problem: the warehouse holds four hundred raw tables, someone builds six good clean ones, and everyone keeps building questions on the raw four hundred because that is what the data picker shows them.

The **Library** is the answer to that. It is a curated subtree — a `library` root holding a **Data** collection (`library-data`) and a **Metrics** collection (`library-metrics`) — and it changes what everyone else sees:

- Tables **published** to Data appear **first** in every data picker and rank up in search.
- Metrics saved to Metrics are prioritized in the nav, in search, and in the query builder.

So publishing is not filing. It is a statement — _start from these; they are the ones we trust_ — and it is the last step of a data-modeling job, not a step in the middle of one. EE-only: needs the `library` premium feature, v59+.

## The two cascades — the thing to understand before you publish

Neither verb touches only the tables you name.

- **`publish` carries a table's upstream dependencies with it.** Publishing a clean table whose sources were not published would put trusted data on top of invisible data, so Metabase publishes the sources too.
- **`unpublish` carries a table's downstream dependents.** Unpublishing something everyone's tables were built on would leave trusted tables resting on untrusted ones, so Metabase unpublishes those as well.

The practical consequence: **`database_ids` on a whole database is almost never what the user means.** Publishing a database publishes its raw tables, which is the exact problem the Library exists to fix. Name the tables. Say which ones you are about to publish, and confirm, before you publish anything a user did not name.

## Who may publish

**Admin or data analyst.** Curate permission alone is not enough — that is the surprising one. The call also **403s unless the caller has both write and query permission on every affected table**, and "affected" includes the cascade above, so a publish can fail on a table the user never mentioned.

## What deserves to be published

The finished, analysis-ready tables — the wide, clean, human-readable ones a person should build a question on without asking anybody first. Typically the output tables of your transforms, **after** their metadata is curated (`metadata` skill): a published table with a column called `cust_id_2` and no description is a trusted table nobody can use.

Hold back: raw source tables, staging and intermediate tables, half-built work, anything you would have to explain before someone could query it.

A table's publish state is visible on the table itself — `browse_data` `{action: "list_tables", database_id: 1}` carries `is_published` on every table it returns.

## Operations

The `library` tool takes one `action`. The Library is created on demand — the first `publish` provisions it if it does not exist, and resolves the Data collection itself, so there is no collection id to look up.

```
{action: "get"}                                    → the Library, and its Data / Metrics collection ids
{action: "publish", table_ids: [12, 15]}           → publish these tables (and their upstream sources)
{action: "publish", schema_ids: ["1:analytics"]}   → every table in a schema
{action: "unpublish", table_ids: [12]}             → unpublish (and every table downstream of it)
```

Each `schema_ids` entry is `"<database id>:<schema>"` (e.g. `"1:public"`) — a bare schema name is rejected. The three selectors (`table_ids`, `database_ids`, `schema_ids`) combine, and `publish` / `unpublish` need at least one of them.

`{action: "get"}` on an instance that has never published anything reports that there is no Library yet; publish into it and it exists.

## Publishing and git-sync

Published tables are how table and field metadata gets into git at all: descriptions, semantic types, FK targets, segments and measures serialize **only for Library-published tables**, and only when the Library collection itself is in the sync scope.

Publishing does **not** put the Data collection in that scope. This is the classic trap — publish the tables, write the metadata, then the dirty list comes back empty and nothing lands in the repo. The fix is one call, on the Data collection id that `{action: "get"}` reports:

```
library    {action: "get"}                                        → the Data collection id
git_sync   {action: "add_collection", collection_id: <data id>}   → put it in the sync scope
```

The `git-sync` skill's "Published table metadata (Library) and sync scope" section is the full account.

## Where this sits in a data project

Build clean tables (`transform_write`) → curate their metadata (`metadata_write`) → define reusable segments, measures and metrics on them → **publish the tables to the Library** so everyone else starts from them. That arc is the `data-workflow` skill; this is its last mile.

## Don't

- **Don't publish a whole database** because it is one selector instead of a list of table ids. The cascade makes it worse, not just bigger.
- **Don't publish a table before its metadata is curated.** Trusted-but-unreadable is not trusted.
- **Don't publish silently.** Say which tables you are about to publish (and that upstream sources will come along) and confirm.
- **Don't assume publishing carried the metadata to git.** It does not, until the Library collection is in the sync scope.
