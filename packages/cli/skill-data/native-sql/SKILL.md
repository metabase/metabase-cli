---
name: native-sql
description: Write native SQL queries inside Metabase representation YAML files - a card's `dataset_query` or a transform's `source.query` with an `mbql.stage/native` stage. Covers the stage shape, template tags (variables, field filters with natural-key field refs, temporal-unit, snippets, card references, tables), optional `[[ ]]` clauses, snippet entity files under `collections/snippets/`, and card `parameters` wiring. Validate with `mb check`. Triggers - "write a SQL question", "add a filter widget to my SQL", "parameterize this query", "use a field filter", "create a snippet", "reference a saved question in SQL", "why does my variable return no rows".
allowed-tools: Read, Write, Edit, Bash
---

# Native SQL

A native query is an `mbql/query` with one `mbql.stage/native` stage: a SQL string plus a `template-tags` list. Prefer a structured MBQL query (load `mbql`). Use native SQL for engine-specific functions, CTEs, complex window logic, or when the user asks for SQL.

The authority is the spec's **Native Query** and **Snippet** sections and `common/query.yaml` (`native_stage`, `template_tag`). Paths are in `representations`.

## A native card is one stage with SQL and a tag list

```yaml
name: Orders by category
entity_id: <21-char NanoID>
creator_id: admin@example.com
display: table
visualization_settings: {}
dataset_query:
  "lib/type": mbql/query
  database: Sample Database
  stages:
    - "lib/type": mbql.stage/native
      native: |-
        SELECT PRODUCTS.CATEGORY, COUNT(*) AS n
        FROM ORDERS
        JOIN PRODUCTS ON ORDERS.PRODUCT_ID = PRODUCTS.ID
        WHERE ORDERS.TOTAL > {{min_total}}
          [[AND {{category}}]]
        GROUP BY PRODUCTS.CATEGORY
      template-tags:
        - type: number
          name: min_total
          id: 6b0a3f4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b
          display-name: Minimum total
          default: 0
        - type: dimension
          name: category
          id: 0f9e8d7c-6b5a-4c3d-9e2f-1a0b9c8d7e6f
          display-name: Category
          dimension:
            - field
            - {}
            - [Sample Database, PUBLIC, PRODUCTS, CATEGORY]
          widget-type: string/=
serdes/meta:
  - id: <same entity_id>
    label: orders_by_category
    model: Card
```

- `native` is the SQL string. Use a `|-` block scalar for multi-line SQL.
- `template-tags` is a list. Omit it for a query without tags.
- A transform uses the same query under `source.query`.

## Every `{{name}}` needs one matching tag

- The `{{name}}` in the SQL must equal the tag's `name`, including case. Names are unique within the list.
- Every tag needs `type`, `name`, `display-name`, and `id`.
- `id` is a v4 UUID. Mint one per tag with `uuidgen | tr 'A-Z' 'a-z'`. Never reuse one.
- A `{{name}}` without a tag fails when the query runs, not at `mb check`.

| `type`                     | SQL                                         | Extra properties                                                                 |
| -------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------- |
| `text`                     | `WHERE CATEGORY = {{cat}}`                  | `default`, `required`. Value is quoted.                                          |
| `number`                   | `WHERE PRICE > {{min}}`                     | `default`, `required`. Value is inserted as-is.                                  |
| `date`                     | `WHERE CREATED_AT > {{after}}`              | `default` (ISO date), `required`. Value is quoted.                               |
| `boolean`                  | `WHERE {{active}}`                          | `default`, `required`. Becomes `1 = 1` or `1 <> 1`.                              |
| `dimension` (field filter) | `WHERE {{cat}}` (bare)                      | `dimension`, `widget-type` (required); `default`, `required`, `options`, `alias` |
| `temporal-unit`            | `SELECT {{period}} ... GROUP BY {{period}}` | `dimension` (required); `default` (e.g. `month`), `alias`                        |
| `snippet`                  | `{{snippet: Active Orders}}`                | `snippet-name`, `snippet-id` (both required)                                     |
| `card`                     | `FROM {{#1-top_products}}`                  | `card-id` (required)                                                             |
| `table`                    | `FROM {{src}}`                              | `table-id` (table ref, required), `emit-alias`                                   |

## Default to a field filter when the tag filters a real column

- A **field filter** (`type: dimension`) binds a widget to a column. It gives a dropdown or date picker and expands to the right SQL (`=`, `IN`, a date range).
- Write a field filter **bare**: `WHERE {{category}}`. `WHERE CATEGORY = {{category}}` breaks the expansion. This is the most common native SQL bug.
- A field filter binds only a physical column. For an expression, aggregate, or CTE column, use a variable.
- A **variable** (`text`, `number`, `date`, `boolean`) is a literal splice. Write the operator yourself. Use variables for `LIMIT {{n}}`, thresholds, and other non-column values.

Field filter rules:

- `dimension` is `[field, {}, <field ref>]`: options map second, the 4-part ref from `mb metadata` third. Never numeric ids.
- `widget-type` must fit the column type: `string/=` `string/!=` `string/contains` `string/does-not-contain` `string/starts-with` `string/ends-with`, `number/=` `number/!=` `number/>=` `number/<=` `number/between`, `date/single` `date/range` `date/relative` `date/month-year` `date/quarter-year` `date/all-options`, `boolean/=`. `date/all-options` is the most flexible date widget.
- Set `alias` when the SQL gives the table an alias, e.g. `alias: o.CREATED_AT` for `FROM ORDERS o`.
- Put a string filter's case sensitivity in `options: {case-sensitive: false}`.

## Wrap optional clauses in `[[ ]]`

- Put the keyword inside the brackets: `[[AND {{category}}]]`, not `AND [[{{category}}]]`.
- Metabase drops the whole bracketed clause when its tag has no value.
- Brackets don't nest. With several optional clauses, start with a real condition: `WHERE true [[AND {{a}}]] [[AND {{b}}]]`.
- A field filter without a value leaves the query unfiltered, so `WHERE {{category}}` needs no brackets.

## Snippets are separate entity files

A snippet is a reusable SQL fragment in `collections/snippets/<slug>.yaml`:

```yaml
name: Active Orders
entity_id: <21-char NanoID>
creator_id: admin@example.com
content: "STATUS = 'active' AND TOTAL > 0"
serdes/meta:
  - id: <same entity_id>
    label: active_orders
    model: NativeQuerySnippet
```

- `content` is bare SQL. Metabase inserts it verbatim where the tag appears.
- Set `collection_id` to a snippet collection's entity_id to file it in a folder. Omit it for the root snippet collection.
- The tag's `name` is `"snippet: <snippet name>"`, quoted because of the `: `. `snippet-name` equals the snippet's `name`, and `snippet-id` is its `entity_id`.
- Snippets take no parameter values. Edit the snippet file once to change every query that uses it.

## Card references embed a placeholder number

A `card` tag inlines another card's query as a CTE. The SQL uses `{{#<number>-<slug>}}`, and the tag's `name` is `"#<number>-<slug>"`. Quote the name: an unquoted `#` starts a YAML comment.

- `card-id` is the referenced card's `entity_id`. That is the real link.
- The number is the card's numeric id in Metabase. A repo file can't know it, so write any positive integer. The import rewrites it to the referenced card's id.
- The referenced card runs with its own saved parameter defaults. The parent query can't override them.

## Declare card `parameters` only for defaults and value lists

Metabase derives basic widgets from the template tags. Add an entry to the card's `parameters` list to set a default or a value source. Link it to the tag with `target`:

```yaml
parameters:
  - id: 5c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f
    name: Category
    slug: category
    type: string/=
    target: [dimension, [template-tag, category]] # dimension and temporal-unit tags
    values_source_type: static-list
    values_source_config:
      values: [[Widget, Widget], [Gadget, Gadget]]
```

- Use `[variable, [template-tag, <name>]]` for `text`, `number`, `date`, and `boolean` tags.
- A dashboard filter maps to a native card with the same `target` forms. Load `dashboard` for `parameter_mappings`.

## Validate, then ship

1. Get table and field refs from `mb metadata <db> <table>`. Check `values` before you pick a default for a string filter.
2. Write the card, and the snippet file if you use one.
3. Run `mb check` until it passes.
4. Run `mb save -m "<msg>"`.

`mb check` validates YAML shape only. It does not parse SQL, match `{{tags}}` to the list, or resolve refs. SQL errors show up when the query runs.

## Don't

- Don't put an operator in front of a field filter.
- Don't write DDL or several `;`-separated statements. A native query is one `SELECT` statement. Use a `transform` to build a table.
- Don't expect `[[ ]]` to fix a value mismatch. `WHERE plan = {{p}}` returns no rows on a case-sensitive engine when the value's case is wrong.
