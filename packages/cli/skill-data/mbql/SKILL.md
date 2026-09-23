---
name: mbql
description: Write structured MBQL queries inside Metabase representation YAML files - a card's `dataset_query`, a transform's `source.query`, a segment or measure `definition`. Covers the stage shape, natural-key field refs, the options-second clause rule, explicit and implicit (FK) joins, multi-stage pipelines, aggregation naming and refs, temporal bucketing, binning, and segment/metric/measure refs. Validate with `mb check`. Triggers - "write an MBQL query", "the dataset_query is wrong", "aggregate and group by", "join two tables", "filter on an aggregate", "month-over-month".
allowed-tools: Read, Write, Edit, Bash
---

# MBQL

MBQL is the structured query format inside representation YAML. Prefer it to native SQL: it is portable across database engines. Use a native stage (load `native-sql`) only when MBQL can't express the query.

The authority is the spec's **MBQL Query** section and `common/query.yaml` + `common/ref.yaml` (paths in `representations`). The operator catalog is in [references/operators.md](references/operators.md).

## One query shape serves four entities

| Entity    | The query lives at                         | Constraint                                                          |
| --------- | ------------------------------------------ | ------------------------------------------------------------------- |
| card      | `dataset_query`                            | none                                                                |
| transform | `source.query` (with `source.type: query`) | none                                                                |
| segment   | `definition`                               | one stage: `source-table` + `filters`                               |
| measure   | `definition`                               | one stage: `source-table` + exactly one `aggregation`, no `filters` |

The value is the `mbql/query` map itself:

```yaml
dataset_query:
  "lib/type": mbql/query
  database: Sample Database
  stages:
    - "lib/type": mbql.stage/mbql
      source-table: [Sample Database, PUBLIC, ORDERS]
      aggregation:
        - - count
          - {}
      breakout:
        - - field
          - temporal-unit: month
          - [Sample Database, PUBLIC, ORDERS, CREATED_AT]
```

- `database` is the database name. `source-table` is a table ref. Copy both from `mb metadata`.
- Only the first stage takes `source-table` or `source-card` (a card's `entity_id`).
- Never wrap the query in the legacy `{type: query, query: {...}}` envelope.

## Every clause puts its options map second

A clause is `[operator, options, ...args]`. The options map is element 1, always present, `{}` when empty.

```yaml
- - field
  - {} # options: never null, never omitted
  - [Sample Database, PUBLIC, ORDERS, TOTAL]
- - "="
  - {}
  - [field, {}, [Sample Database, PUBLIC, PRODUCTS, CATEGORY]]
  - Widget
  - Gadget # extra values = IN
```

The rule holds for filters, aggregations, breakouts, expressions, `order-by`, and join conditions. The legacy `[field, <ref>, null]` shape belongs only in dashboard and card **parameter targets**, never in `stages`.

YAML quoting: quote `"-"` and `">"`/`">="` when they start a list item. An unquoted `-` parses as a list marker and an unquoted `>` as a block scalar.

## Field refs come from `mb metadata`

- **Table column:** `[field, {}, <ref>]` with the 4-part ref from `mb metadata <db> <table>`. A schemaless database has `null` in the schema slot.
- **Previous-stage or `source-card` column:** reference it by column name plus `base-type`: `[field, {base-type: type/Integer}, count]`.
- **Filter values:** for a field whose `values` is non-null, use those exact strings. Don't guess values or case.

Field options: `base-type`, `temporal-unit`, `binning`, `join-alias`, `source-field`, `source-field-name`, `source-field-join-alias`.

## Choose an implicit join for a single FK hop

To read a column from the table an FK points at, set `source-field` to the FK column's ref. The third element is the target column. Check that the FK row's `fk_target` in `mb metadata` points at that table.

```yaml
- - field
  - source-field: [Sample Database, PUBLIC, ORDERS, PRODUCT_ID]
  - [Sample Database, PUBLIC, PRODUCTS, CATEGORY]
```

Use an explicit join for a non-FK condition, a non-left strategy, or control over which joined columns return. `stages`, `conditions`, `alias`, and `strategy` are required:

```yaml
joins:
  - alias: Products
    strategy: left-join # left-join | right-join | inner-join | full-join
    fields: none # all | none | list of field refs
    stages:
      - "lib/type": mbql.stage/mbql
        source-table: [Sample Database, PUBLIC, PRODUCTS]
    conditions:
      - - "="
        - {}
        - [field, {}, [Sample Database, PUBLIC, ORDERS, PRODUCT_ID]]
        - [field, { join-alias: Products }, [Sample Database, PUBLIC, PRODUCTS, ID]]
```

Every reference to a joined column carries `join-alias: <alias>`, in the condition and downstream.

## Add a stage to filter on an aggregate

A stage can't filter on its own aggregation. Aggregate in stage 0, then filter in stage 1 by column name:

```yaml
stages:
  - "lib/type": mbql.stage/mbql
    source-table: [Sample Database, PUBLIC, ORDERS]
    aggregation:
      - - sum
        - { name: revenue, display-name: Revenue }
        - [field, {}, [Sample Database, PUBLIC, ORDERS, TOTAL]]
    breakout:
      - [field, {}, [Sample Database, PUBLIC, ORDERS, PRODUCT_ID]]
  - "lib/type": mbql.stage/mbql
    filters:
      - - ">"
        - {}
        - [field, { base-type: type/Float }, revenue]
        - 1000
    limit: 10
```

- Set `name` (column name) and `display-name` (header) on aggregations. Without `name`, later stages must use the default (`sum`, `count`, `avg_2`, ...).
- A transform's aggregation `name` becomes the output table's column name.

## Give an aggregation a `lib/uuid` only to reference it

`lib/uuid` is optional. Omit it everywhere except an aggregation you reference with `[aggregation, {}, "<uuid>"]`, such as in the same stage's `order-by`. The ref's third element is the uuid string, never a position.

```yaml
aggregation:
  - - count
    - lib/uuid: 3f6c1c8e-2d4b-4a57-9d0e-8b1f2a7c9e11
order-by:
  - - desc
    - {}
    - [aggregation, {}, 3f6c1c8e-2d4b-4a57-9d0e-8b1f2a7c9e11]
```

Mint each uuid with `uuidgen | tr 'A-Z' 'a-z'`. Every `lib/uuid` in a query must be unique. Expressions are referenced by name: `[expression, {}, Profit]`, where `Profit` is the expression's `lib/expression-name`.

## Bucket and bin in the field options

- **Time:** `temporal-unit: month` on a datetime field. Truncation units: `day`, `week`, `month`, `quarter`, `year`, and finer. Extraction units return an integer: `day-of-week`, `month-of-year`, `hour-of-day`, and others.
- **Numbers:** `binning: {strategy: num-bins, num-bins: 10}`, `{strategy: bin-width, bin-width: 25}`, or `{strategy: default}`.
- **Period-over-period:** `offset` is valid only inside `aggregation`. Pair it with a temporal breakout:

```yaml
aggregation:
  - - sum
    - { name: revenue }
    - [field, {}, [Sample Database, PUBLIC, ORDERS, TOTAL]]
  - - offset
    - { name: prev_month }
    - [sum, {}, [field, {}, [Sample Database, PUBLIC, ORDERS, TOTAL]]]
    - -1
breakout:
  - [field, { temporal-unit: month }, [Sample Database, PUBLIC, ORDERS, CREATED_AT]]
```

## Reuse saved definitions by entity_id

- `[segment, {}, <segment entity_id>]` in `filters`.
- `[measure, {}, <measure entity_id>]` or `[metric, {}, <metric card entity_id>]` in `aggregation`. A measure can reference other measures, not metrics.

## `fields` must list every expression

`fields` omitted selects all columns. When a stage has both `fields` and `expressions`, include every expression in `fields` as `[expression, {}, <name>]`.

## `mb check` validates shape, not meaning

1. Get refs and values: `mb metadata`, `mb metadata <db>`, `mb metadata <db> <table>`.
2. Write the YAML. Copy a similar query from the repo or the spec when one exists.
3. Run `mb check`. Fix the error with the deepest `path`; the `must match "then" schema` errors above it are echoes. `must be object` at a path ending in `/1` means a missing or misplaced options map.
4. Run `mb save -m "<msg>"`. The import runs the full query validator. Read its error message on failure.

`mb check` does not resolve names. A misspelled table, column, alias, expression name, or aggregation uuid passes `check` and fails at import. Copy refs verbatim from `mb metadata` and keep aliases and names consistent within the query.
