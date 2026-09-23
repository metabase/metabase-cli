---
name: metabase-database-metadata
description: Read the project's schema from `.metadata/databases/`, the YAML tree of databases, tables and fields `mb metadata extract` writes from the connected Metabase. Load when reasoning about tables, columns, types, or foreign keys, before writing any query or content file, or when the user asks to refresh metadata. `spec.md` beside this file carries the full type hierarchy and path rules.
allowed-tools: Read, Glob, Grep, Bash, AskUserQuestion
---

# Metabase database metadata

The connected Metabase's databases, tables and fields live on disk as a tree of small YAML files, one per database and one per table with its fields inline. Numeric ids are left out; foreign keys are natural-key tuples like `["Sample Database", "PUBLIC", "ORDERS"]`, the same form content files use (`mb skills get metabase-representation-format`). The format is specified in `spec.md` beside this file (`mb skills path metabase-database-metadata`, then Read `spec.md`).

## Layout

Everything sits under `.metadata/` at the repository root:

- **`.metadata/databases/`**: the YAML tree, and the agent's schema source. Read, glob and grep it.
- **`.metadata/table_metadata.json`**: the raw export the tree is built from. It can run to gigabytes. Never open, grep, or pass it to a tool.

`.metadata/` is gitignored. The app adds it to `.gitignore` after asking the user; when it is missing there, ask before adding it, because committing the tree can bloat the repository past use.

| Entity   | File                                                                                                             | Holds                                                    |
| -------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Database | `.metadata/databases/{db}/{db}.yaml`                                                                             | the connection's name and engine                         |
| Table    | `.metadata/databases/{db}/schemas/{schema}/tables/{table}.yaml` (`.../{db}/tables/{table}.yaml` when schemaless) | the table and a `fields` array with every column         |
| Field    | inside its table's file                                                                                          | types, semantic type, coercion, FK target, nested parent |

## Producing and refreshing the tree

Do not fetch at session start. If `.metadata/databases/` exists, use it as it stands. When something in it looks stale or a table is missing, say so and let the user decide whether to refresh.

<!-- requires: metadataExport -->

```bash
mb metadata extract                               # .metadata/table_metadata.json, then .metadata/databases/
mb metadata extract --databases 'Sample Database' # only these databases
```

The command downloads the export from the connected Metabase and rebuilds `databases/` from it, replacing the previous tree, and prints the database, table and field counts. The app runs the same command from **Refresh metadata**.

<!-- /requires -->

A table the tree lacks can be read from the instance: `mb db get <db-id> --include tables`, then `mb table fields <table-id>`. After a transform creates a table, the tree holds it once it is refreshed; until then read it from the instance the same way.

## Foreign keys

- Database: its name, `"Sample Database"`.
- Table: `[database, schema_or_null, table]`.
- Field: `[database, schema_or_null, table, field, ...nested]`; `["Sample Database", "PUBLIC", "EVENTS", "DATA", "user", "name"]` is the JSON-unfolded column `DATA.user.name`.

On a field, `fk_target_field_id` names the column a foreign key points at, and `parent_id` the parent of a nested field. These tuples are what a content file's query writes for `source-table` and field references.

## Types on a field

- **`database_type`**: the driver's native type (`BIGINT`, `VARCHAR`, `JSONB`).
- **`base_type`**: the Metabase type for it (`type/BigInteger`, `type/Text`).
- **`effective_type`**: the type used at query time, present only when coercion changes it.
- **`coercion_strategy`**: the rule producing `effective_type` (`Coercion/ISO8601->DateTime`).
- **`semantic_type`**: the business label (`type/PK`, `type/FK`, `type/Email`, `type/Category`), which drives widgets and formatting.

The full hierarchy and every coercion strategy are in `spec.md`.

## What the tree is not

The tree is a read-only snapshot. Editing it changes nothing in Metabase and the next extract overwrites it. Table and field metadata that Metabase imports lives elsewhere, as files under `databases/` for Library-published tables (the `metadata` skill).
