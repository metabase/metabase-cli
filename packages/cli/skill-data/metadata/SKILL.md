---
name: metadata
description: Set Metabase field and table metadata via the `mb` CLI — semantic types, foreign-key targets, dropdown/scan behavior, column visibility, and display names. The point is the causal chain — one metadata edit unlocks a downstream feature (a FK target enables joins and linked filters; `has_field_values` picks the filter widget; `visibility_type` can block queries). Covers `field update` / `table update`, the writable-vs-read-only split, the semantic-type catalog, why semantic types are labels not casts (and how to actually cast), and sync-vs-scan-vs-fingerprint. Triggers — "set this column as currency / email / a category", "mark this as a foreign key", "make this column a dropdown", "why doesn't the query builder suggest a join", "hide this column", "set the entity key".
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

# Metadata

Metabase reads the raw column types from your warehouse; **metadata** is the layer you edit on top to make columns behave well — the right filter widget, joins, formatting, maps. You set it per-column with `mb field update <id>` and per-table with `mb table update <id>`. Both are **PATCH** — send only the keys you're changing.

Metadata is a small set of fields with large, indirect effects. Get the field ids from `mb table get <id> --include fields` (or `mb table fields <id>`); inspect a column's shape with `mb field get <id>`, its live cardinality with `mb field summary <id>`, its cached distinct set with `mb field values <id>`. General flag/output/body mechanics live in `core`.

## The causal chain — set X, unlock Y

This is the whole point of the skill. Each edit below is a key in the `field update` (or `table update`) body; the value change is what turns a feature on.

| Set (via `field update`)                                             | Unlocks / does                                                                                                                                 |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `semantic_type: "type/PK"`                                           | marks the row's identity key — enables record/detail view, and lets other tables' FKs point here                                               |
| `semantic_type: "type/FK"` **+** `fk_target_field_id: <pk field id>` | the join relationship — implicit FK joins in queries (`mbql` `source-field`), query-builder join suggestions, and dashboard **linked filters** |
| `semantic_type: "type/Currency"` / `type/Email` / `type/City` / …    | correct display formatting and the matching filter widget (and region/pin maps for location types)                                             |
| `has_field_values: "list"` (or `"auto-list"`)                        | a **dropdown** filter widget, backed by a scanned distinct-value set                                                                           |
| `has_field_values: "search"`                                         | a **search box** (no value set stored) — for high-cardinality columns                                                                          |
| `has_field_values: "none"`                                           | a plain input box, no dropdown                                                                                                                 |
| `visibility_type: "sensitive"` or `"retired"`                        | **blocks queries** that touch the field — not a UI hint, an error                                                                              |
| `visibility_type: "hidden"`                                          | removes the column from the query builder and data reference (SQL can still read it — **not access control**)                                  |
| `visibility_type: "details-only"`                                    | hidden in table views, shown in the single-record detail view (for long blobs)                                                                 |
| `coercion_strategy: <strategy>`                                      | **actually casts** the column — the only entry here that changes the value's type (below)                                                      |
| `display_name` / `description`                                       | the human label and help text shown everywhere                                                                                                 |

`table update` carries the table-level equivalents: `display_name`, `description`, `visibility_type` (`hidden` / `technical` / `cruft` — hides the whole table from the builder), `field_order`, and `entity_type`.

## Foreign keys are the highest-leverage edit

A FK relationship is what makes a warehouse browsable. Set it in **two keys on the FK column**, in one PATCH:

```bash
mb field update 1711 --body '{"semantic_type":"type/FK","fk_target_field_id":1684}' --profile <n> --json
```

`1711` is `orders.customer_id`; `1684` is `customers.id` (which should itself be `type/PK`). Once set:

- Queries can pull columns from the related table with no explicit join — `["field", {"source-field": 1711}, 1682]` in MBQL (see `mbql`).
- Dashboard **linked filters** become possible (a State filter narrowing a City filter). **Linked filters read only these table-metadata FKs** — never a join you wrote inside a saved question — which is why a linked filter that "shows values it shouldn't" almost always means the FK isn't set in metadata. (See `dashboard`.)

Removing the `type/FK` semantic type auto-clears `fk_target_field_id`. Point a FK only at a field in the **same database** — v60+ rejects a cross-database target; v58–v59 accept it silently and leave a broken relationship.

## Semantic types are labels, not casts

The commonest misconception. `semantic_type: "type/Quantity"` on a text column does **not** make it a number — it changes formatting and widget choice, nothing about the stored value. Sorting still sorts as text.

To genuinely change the type, use **`coercion_strategy`**, which casts `base_type` → an `effective_type` (e.g. a Unix-epoch integer read as a timestamp, or a numeric string read as a number):

```bash
mb field update 42 --body '{"coercion_strategy":"Coercion/UNIXSeconds->DateTime"}' --profile <n> --json
```

`base_type`, `effective_type`, and the physical `name` are **read-only** — set by warehouse sync, never editable here. For a durable transformation (splitting, combining, recomputing columns), build a `transform` rather than leaning on coercion.

The full semantic-type catalog — every value grouped by the base type it attaches to, plus the `has_field_values` and `visibility_type` value tables and the exact writable-key lists — is in `references/semantic-types.md` (`mb skills get metadata --full`).

## Sync, scan, fingerprint — three different refreshes

When a column looks stale or missing, know which one you need (`db` verbs, mechanics in `core`):

- **Sync** (`mb db sync-schema <id> --wait`) — re-reads table/column **structure** (new tables, new columns, types). Run after a schema change.
- **Scan / rescan** (`mb db rescan-values <id>`) — refreshes the **distinct-value sets** behind dropdown filters. Run when a `list` column's values changed but its dropdown is stale.
- **Fingerprint** — value-distribution stats (min/max, null count) computed on a sample; drives smart defaults. Refreshed by sync; not a separate CLI verb.

A newly connected database or a missing expected column usually just needs a `sync-schema --wait` before you conclude anything.

## Don't

- Don't expect a `semantic_type` to cast — it's a label. Use `coercion_strategy`, or a `transform`.
- Don't edit `name`, `base_type`, or `effective_type` — they're read-only from sync.
- Don't treat `visibility_type: hidden` as security — it only hides from the builder; native SQL still reads the column. Real restriction is a permissions concern, outside the CLI.
- Don't set a `type/City` / `type/State` filter and expect a map or clean dropdown if the values are inconsistent (abbreviations mixed with full names) — fix the values first (a `transform`), then the metadata.
- Don't blame the data when a dashboard linked filter misbehaves — check the FK is set here first.
