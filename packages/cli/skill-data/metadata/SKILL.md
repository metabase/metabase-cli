---
name: metadata
description: Table and field metadata, meaning semantic types, foreign-key targets, dropdown and scan behavior, column visibility, display names and descriptions, and the downstream feature each unlocks (a FK target enables joins and linked filters; `has_field_values` picks the filter widget; `visibility_type` can block queries). Covers where metadata lives (the table files of Library-published tables), what is sync-owned, why semantic types are labels not casts, and sync vs. scan. Triggers are "set this column as currency", "mark this as a foreign key", "make this a dropdown", "why doesn't the query builder suggest a join", "hide this column".
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

# Metadata

Metabase reads the raw column types from the warehouse; **metadata** is the layer on top that makes columns behave: the right filter widget, joins, formatting, maps. It is a small set of settings with large, indirect effects. Read a column's current shape with `mb table get <id> --include fields`, `mb field get <id>`, its live cardinality with `mb field summary <id>`, and its cached distinct set with `mb field values <id>`; `.metadata/databases/` holds the same snapshot on disk (`metabase-database-metadata`).

## Where metadata lives

<!-- requires: library -->

**A Library-published table in a synced collection** has one file, `databases/<db>/schemas/<schema>/tables/<table>/<table>.yaml`, whose `serdes/meta` ends in `TableUserSettings`: the values set on the table, and under `fields` one entry per field with settings of its own, each naming its field in its `serdes/meta`. Edit the keys that file carries, commit, and import the branch (the loop in `core`). Both gates hold or the file never applies: the table is published (`mb library publish --table-ids <id>`, `table get` shows `is_published`), and the Library Data collection is in `synced_collections` (`mb git-sync status --json`). Publish only finished, final-layer tables; a staging table in the Library is a staging table in every picker.

`mb validate` checks that file, `fields` entries included, like any other content file.

<!-- /requires -->

**Any other table** has no file form, and no command sets its metadata. Name the setting, the column, and what it unlocks, and ask the user to set it in Metabase's table metadata editor, or to publish the table so it gets files. Record the request with the work it blocks.

## The causal chain: set X, unlock Y

| Setting on a field                                           | Unlocks or does                                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `semantic_type: type/PK`                                     | marks the row's identity; enables detail view and lets other tables' FKs point here                                      |
| `semantic_type: type/FK` **and** `fk_target_field_id`        | the join relationship: implicit FK joins (`source-field` in `mbql`), join suggestions, and dashboard **linked filters**  |
| `semantic_type: type/Currency`, `type/Email`, `type/City`, … | display formatting and the matching filter widget (and region or pin maps for location types)                            |
| `has_field_values: list` (or `auto-list`)                    | a **dropdown** widget backed by a scanned distinct-value set                                                             |
| `has_field_values: search`                                   | a **search box**, no value set stored, for high-cardinality columns                                                      |
| `has_field_values: none`                                     | a plain input box                                                                                                        |
| `visibility_type: sensitive` or `retired`                    | **blocks queries** that touch the field; an error, not a UI hint                                                         |
| `visibility_type: hidden`                                    | removes the column from the query builder and data reference; native SQL still reads it, so it is **not access control** |
| `visibility_type: details-only`                              | hidden in table views, shown in the single-record view (long blobs)                                                      |
| `coercion_strategy`                                          | **actually casts** the column; the only entry here that changes the value's type                                         |
| `display_name`, `description`                                | the human label and help text shown everywhere                                                                           |

On the table: `display_name`, `description`, `visibility_type` (`hidden`, `technical`, `cruft` hide the whole table from the builder), `field_order`, `entity_type`, and the owner.

In a field file a FK target is a natural key, `fk_target_field_id: [Sample Database, PUBLIC, CUSTOMERS, ID]`, and the target should itself be `type/PK`. Point a FK only at a field in the same database. Removing `type/FK` clears the target.

## Foreign keys are the highest-leverage edit

A FK makes a warehouse browsable. Once set, queries pull columns from the related table with no explicit join (`source-field` in `mbql`), and dashboard **linked filters** work. **Linked filters read only metadata FKs**, never a join inside a saved question, so a linked filter that shows values it shouldn't almost always means the FK is missing here.

## Semantic types are labels, not casts

`semantic_type: type/Quantity` on a text column does **not** make it a number; it changes formatting and widget choice, and sorting still sorts as text. To change the type, set `coercion_strategy`, which casts `base_type` to an `effective_type` (an epoch integer read as a timestamp: `Coercion/UNIXSeconds->DateTime`). For a durable change (splitting, combining, recomputing), build a transform instead.

`name`, `base_type`, `effective_type` and `database_type` are sync-owned; never edit them.

The full semantic-type catalog, the `has_field_values` and `visibility_type` value tables, and the common coercion strategies are in `references/semantic-types.md` (`mb skills get metadata --full`).

## Sync, scan, fingerprint

- **Sync** (`mb db sync-schema <id> --wait`): re-reads structure, new tables and columns and types. Run after a schema change.
- **Scan** (`mb db rescan-values <id>`): refreshes the distinct-value sets behind dropdowns.
- **Fingerprint**: value-distribution stats computed by sync; no separate verb.

A newly connected database or a missing column usually needs `sync-schema --wait` before you conclude anything.

## Don't

- Don't expect a `semantic_type` to cast.
- Don't edit sync-owned keys.
- Don't treat `visibility_type: hidden` as security.
- Don't set a `type/City` or `type/State` and expect a clean map or dropdown over inconsistent values; fix the values in a transform first.
- Don't blame the data when a linked filter misbehaves; check the FK first.
