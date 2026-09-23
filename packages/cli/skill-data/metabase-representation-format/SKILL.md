---
name: metabase-representation-format
description: The Metabase Representation Format, the YAML files that are the content of this repository (collections, cards, dashboards, documents, segments, measures, snippets, transforms, transform tags and jobs, Python libraries). Load before creating, editing, or reviewing any content file. Covers entity schemas, placement fields, natural-key references, MBQL and native queries in file form, visualization settings, parameters, and the folder layout; `spec.md` beside this file carries the full detail.
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

# Metabase Representation Format

Metabase content in this repository is a tree of YAML files, one entity per file. The format is portable across instances: numeric ids never appear, databases, tables and fields are named by natural key, and every other entity is referenced by its `entity_id`. A file is how an entity is created or changed; the branch reaches the connected Metabase through `mb git-sync import` (the `git-sync` skill).

The format is specified in `spec.md` beside this file (`mb skills path metabase-representation-format`, then Read `spec.md`). Read it on demand, the section the edit touches, not at session start.

## Entities

| Entity            | `serdes/meta` model  | What it is                                                                                                 |
| ----------------- | -------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Collection**    | `Collection`         | Folder-like container. Hierarchy via `parent_id`. Namespaces: `null` (main), `"snippets"`, `"transforms"`. |
| **Card**          | `Card`               | Question, model, or metric (`type`). Holds a `dataset_query`, MBQL or native.                              |
| **Dashboard**     | `Dashboard`          | 24-column grid of `dashcards`, filter `parameters`, optional `tabs`.                                       |
| **Document**      | `Document`           | ProseMirror tree; embeds cards with `cardEmbed`, links entities with `smartLink`.                          |
| **Segment**       | `Segment`            | Saved filter on a table: one stage with `source-table` and `filters`.                                      |
| **Measure**       | `Measure`            | Saved aggregation on a table: one stage with `source-table` and exactly one `aggregation`.                 |
| **Snippet**       | `NativeQuerySnippet` | Reusable SQL fragment, referenced as `{{snippet: Name}}`.                                                  |
| **Transform**     | `Transform`          | Materializes a query or Python script into a table.                                                        |
| **TransformTag**  | `TransformTag`       | Label a job selects transforms by.                                                                         |
| **TransformJob**  | `TransformJob`       | Cron schedule over tags.                                                                                   |
| **PythonLibrary** | `PythonLibrary`      | Shared Python source for Python transforms.                                                                |

## Placement is fields, not folders

Where an entity lands in Metabase is decided by its fields. The folder a file sits in is for people reading the tree; moving a file changes nothing, and changing the field without moving the file works.

- **`collection_id`**: the `entity_id` of the collection; `null` or omitted is the root collection.
- **`parent_id`** on a collection: the only thing that nests it. Without it a collection is root-level wherever its file sits.
- **`dashboard_id`** or **`document_id`** on a card: the card belongs to that dashboard or document and sets the same `collection_id` as its parent. A card never sets both.

Keep the tree readable anyway: a collection's file sits beside its folder (`main/sales.yaml` next to `main/sales/`), items of a collection sit flat in its folder, and a dashboard's own cards sit in a subfolder named like the dashboard.

## Import paths

Metabase reads YAML from these top-level directories only; anything else in the repository is ignored on import:

- `collections/`: `main/`, `snippets/`, `transforms/` by namespace.
- `databases/`: the `segments/` and `measures/` under each table, and the table metadata of Library-published tables in a synced collection (the `metadata` skill).
- `python_libraries/`.
- `transforms/`: `transform_jobs/` and `transform_tags/`.

## References

| Points at                                      | Written as                                               |
| ---------------------------------------------- | -------------------------------------------------------- |
| Database                                       | its name: `Sample Database`                              |
| Table                                          | `[database, schema, table]`; schema `null` if schemaless |
| Field                                          | `[database, schema, table, field]`                       |
| Collection, card, dashboard, segment, measure… | its `entity_id`                                          |
| User (`creator_id`)                            | email                                                    |

Take table and field names from the instance: `mb db get <id> --include tables`, then `mb table get <id> --include fields` (the `core` skill's db traversal). Take a `creator_id` from the files already in the repository, or ask the user for the email to use. A query run with `mb query` uses numeric ids instead; the `mbql` skill covers moving a query between the two forms.

## `serdes/meta`

Every file carries its identity path; the last entry's `model` picks the schema:

```yaml
serdes/meta:
  - id: NDzkGoTCdRcaRyt7GOepg
    label: my_entity_name
    model: Card
```

Nested entities (a dashcard inside a dashboard) carry the parent's entry first. The full rules are in `spec.md`, "SerDes Meta".

## Ids

- `entity_id`: `mb entity-id` (or `--count N`). Never hand-write one; never reuse one across entities of a type.
- `lib/uuid` on MBQL clauses and parameter `id`s: `mb uuid` (or `--count N`).

Piped, both print a JSON array (`["LZfXLFzPPR4NNrgjlWDxn"]`); write the bare string into the file, or pass `--format text` for one id per line.

## Validate

```bash
mb validate                          # every file under the import paths
mb validate collections/main/sales   # a file or directory
```

The schema is picked by `serdes/meta`; each failing file lists JSON pointers to what is wrong. Run it after every edit; it is offline and instant. Validation is structural: a file that passes can still name a table the instance lacks or hold a query that fails, which the import and a run on the instance catch.

## Reading the spec

Beyond the entity shapes, `spec.md` covers the MBQL file form (stages, field references, joins, expressions, aggregations, filter and expression operators, temporal bucketing, binning), native queries and template tags (`text`, `number`, `date`, `boolean`, `dimension`, `temporal-unit`, `card`, `snippet`, `table`), visualization settings, click behavior, and dashboard and card parameters. Open the section the edit needs.
