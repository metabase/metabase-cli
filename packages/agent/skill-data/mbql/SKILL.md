---
name: mbql
description: Author and debug MBQL query bodies — the structured query format behind every tool that takes a query. Covers the JSON shape (flat numeric-id stages, options-object-second clauses, the never-write-a-lib/uuid rule), joins and FK traversal, multi-stage pipelines, aggregation naming, the flat-vs-legacy-envelope footgun, and the iterate-with-execute_query loop. Use when writing or fixing any query — `execute_query`'s `query`, a card's query in `question_write`, a transform's `source.query`, or a segment/measure `definition` — or when the server rejects a query as malformed. Triggers — "write an MBQL query", "the dataset_query is wrong", "aggregate and group by", "join two tables", "month-over-month".
---

# MBQL

MBQL is the query format you author by hand — a flat JSON object every query-taking tool accepts. A native SQL query is **also** MBQL: its single stage is `mbql.stage/native` (raw SQL) instead of `mbql.stage/mbql` (structured), so it rides in the same envelope — see the `native-sql` skill.

Prefer a **structured** stage over a native SQL stage: portable across warehouse engines. Try it first; fall back to a native stage when structured MBQL can't express what you need, or when a structured body keeps failing server-side and you can't resolve it. For native SQL with parameters (template tags, field filters, snippets), read the `native-sql` skill.

## The shape

A flat object — `lib/type`, a numeric `database` id, and an ordered `stages` array. No recursive `source-query` nesting; multi-step queries are sibling stages.

```json
{
  "lib/type": "mbql/query",
  "database": 1,
  "stages": [
    {
      "lib/type": "mbql.stage/mbql",
      "source-table": 7,
      "aggregation": [["count", {}]],
      "breakout": [["field", { "temporal-unit": "month" }, 22]]
    }
  ]
}
```

- **Numeric ids only.** `database`, `source-table`, and field ids are integers you look up with `browse_data` — `list_databases` for the database id, `list_tables` for table ids, `get_fields` for field ids. Never guess an id and never carry one over from another instance. (Git-sync YAML uses _names_ like `[Sample Database, PUBLIC, ORDERS]`; the query body uses numeric ids — don't mix them.)
- **First stage** carries `source-table` (a table id) or `source-card` (a saved card). Later stages omit both and read the previous stage's output columns by name.
- `source-card` references a saved card by its **numeric id** (from `search` or `browse_collection`), not its string entity id; downstream fields are referenced by column name (string), not a field id.

## The one rule that trips everyone: options object is **second**

Every clause is `[op, {options}, ...args]`. The options object is element **1**, args follow.

```json
["field", { "base-type": "type/Text" }, 1779]   // field id is THIRD; options may be empty {}
["count", {}]                                    // no args
["sum",   {}, ["field", {}, 42]]
["=",     {}, ["field", {}, 1779], "delivered"]
["asc",   {}, ["field", {}, 42]]
```

The legacy field shape `["field", id, opts]` (id second) is **rejected**. A slot-1 violation comes back from the server as `must be the field options object` / `must be the clause options object` at a path like `/stages/0/<verb>/<n>/1`.

The same `[op, {options}, …]` rule holds for `aggregation`, `breakout` (a list of field refs), `filters` (implicitly ANDed; nest an explicit `["or", {}, …]` for OR), `order-by`, `expressions`, and join `conditions`.

## `lib/uuid`: you MUST NOT set one

**Never write a `lib/uuid`. Not in any clause, not in any stage, not ever.** You cannot generate a random value, so any UUID you type is invented — and an invented one either fails the format check or collides with another clause. The server mints a unique `lib/uuid` for every clause that omits it, which is every clause you will ever write. An empty options object `{}` is the normal case, and **a correct query contains the string `lib/uuid` exactly zero times.** Grep your body for it before you send it; if it is there, delete it.

The one thing that tempts you into inventing one is **sorting by an aggregation**. In-stage, `["aggregation", {}, "<uuid>"]` addresses its target by that target's `lib/uuid` string — so sorting where you aggregate would mean knowing a uuid you are not allowed to invent. That is the signal you are writing the wrong shape. **Sort in a later stage**, where the aggregation is an ordinary output column addressed by `name` + `base-type` — no uuid exists to reference:

```json
"stages": [
  { "lib/type": "mbql.stage/mbql", "source-table": 185,
    "aggregation": [["sum", { "name": "revenue" }, ["field", {}, 1835]]],
    "breakout":    [["field", {}, 1833]] },
  { "lib/type": "mbql.stage/mbql",
    "order-by": [["desc", {}, ["field", { "base-type": "type/BigInteger" }, "revenue"]]],
    "limit": 10 }
]
```

The `base-type` is required on a string-name ref — omit it and the stage is rejected. Filtering an aggregate works the same way (see **Multi-stage pipelines**); so does a top-N over a join, which is just this shape with `joins` in the first stage.

This holds for every other identifier in a query body: a native template tag's `id` is minted for you from the tag name (see `native-sql`), and a `dimension` field ref takes `{}` for its options. There is no slot in a body you author that you fill with a UUID.

The rejection to recognize: a `lib/uuid` you wrote as a short label comes back as `{:lib/uuid ["should be 36 characters"]}` — the server checks length and nothing else. **The fix is to delete it and sort in a later stage. It is never to pad the label to 36 characters.**

## Authoring loop: run it, read the rejection, fix the body

`execute_query` is the authoring surface. It sends the query to Metabase as-is — there is no local pre-flight, so **the server is the only validator**, and every mistake comes back as a rejection naming the offending path. Run early and often: an execution against the real database is the cheapest check you have.

- Pass the query inline in `query`, or keep it in a file and point `query_file` at it. The file workflow is the one to prefer for anything non-trivial: write the JSON with your editing tools, run it with `query_file`, fix it in place, and when it's right hand the **same file** to `question_write`'s `query_file` — the saved card is then byte-identical to what you ran.
- An **existing** card's query starts the same loop from the other end: `question_write` `{method: "pull", id}` writes the saved query to a file. Edit it there, test it with `execute_query`'s `query_file`, and `update` with the same path — never retype a saved query from a `get_content` read.
- `row_limit` caps the rows returned; `offset` pages a large result (re-call with the same query and the next offset).
- The result is the dataset shape: slim `cols` (`name`, `display_name`, `base_type`, `semantic_type`) plus `rows`. `response_format: "detailed"` returns the full payload (`results_metadata`, per-column fingerprints, `field_ref`) — ask for it only when you need that metadata.
- A native query runs here too: author it as an `mbql.stage/native` stage (see `native-sql`), or use `execute_sql` for plain ad-hoc SQL.

Rejections quote Metabase's own words. The common ones:

- `not a known MBQL clause` → a misspelled or unsupported **operator**. Check the vocabulary in `references/operators.md` (this skill's directory).
- `Initial MBQL stage must have either :source-table or :source-card` → the **first stage** is missing its source (a numeric table or card id); only the first stage takes one, later stages read the previous stage's columns.
- `Invalid :expression reference: no expression named "X"` (or an invalid `:aggregation` reference) → a **ref** points to an expression name / aggregation `lib/uuid` that isn't defined in the query; fix the target string.
- `:expressions ["invalid type, got: {…}"]` → you wrote `expressions` as a name→clause **map**; it is an array of clauses that name themselves with `lib/expression-name`.
- `:base-type ["missing required key, got: nil"]` under an `:aggregation` or `:filters` path → a `["field", {}, "<string>"]` ref with no `base-type`. If the target is an expression in the same stage, the ref is `["expression", {}, "<name>"]`; if it's the previous stage's column, add `base-type`.
- `{:lib/uuid ["should be 36 characters"]}` → you hand-wrote a `lib/uuid` as a short label to sort by an aggregation. Delete it and sort in a later stage; padding the label to 36 characters is not the fix.
- `Duplicate :lib/uuid` → you reused a `lib/uuid`. Omit them (the server mints unique ones) or give each clause a distinct value.
- A `must be the field options object` / `must be the clause options object` path → the slot-1 rule above.

## Where the query is consumed

The same body travels everywhere a query is embedded — it is the identical JSON value in each of these arguments:

| Tool                                                | The query is                                                | Notes                                        |
| --------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------- |
| `execute_query`                                     | `query` (or the JSON in `query_file`)                       | ad-hoc run, rows back                        |
| `question_write` (question / model / metric)        | `query` (or `query_file`) — stored as the card's `dataset_query` | a **flat** `mbql/query` — see footgun below |
| `transform_write`                                   | `source.query`, with `source.type` of `"query"`             | materializes to a warehouse table             |
| `measure_write`                                     | `definition`                                                | one-stage query, exactly one `aggregation`   |
| `segment_write`                                     | `definition`                                                | one-stage query holding only `filters`       |

`question_write` with `card_type: "metric"` holds the same constraint as a measure: exactly one aggregation, at most one time grouping.

## Footgun: the query is the flat mbql/query, not a legacy envelope

The most common mistake. The legacy shape `{ "type": "query", "database": N, "query": {…} }` looks similar but is wrong. A card's `dataset_query`, a transform's `source.query`, and a measure/segment `definition` **are the `mbql/query` value itself**:

```json
{
  "lib/type": "mbql/query",
  "database": 2,
  "stages": [{ "lib/type": "mbql.stage/mbql", "source-table": 190,
               "aggregation": [["count", {}]] }]
}
```

No `type:"query"` wrapper, no `query:` nesting. Wrap the query inside a legacy envelope and it stores silently, then fails at run time with `Initial MBQL stage must have either :source-table or :source-card`.

## Legacy formats you may encounter

Older Metabase servers used a different query envelope (sometimes called MBQL 4 / "legacy MBQL"); the `mbql/query` shape above is what recent servers store and return. You won't author the legacy shapes, but you may see them in queries created long ago. Anything not `lib/type: "mbql/query"` is normalized server-side:

- **Legacy structured** — `{ "type": "query", "database": N, "query": { "source-table": T, … } }`
- **Flat native** — `{ "type": "native", "database": N, "native": { "query": "SELECT …" } }` — the server accepts it, but author the native stage instead (`native-sql`).

Don't author these by hand. To work from a legacy or complex query that already exists, build it in the Metabase UI and pull the body with `get_content` (`include: ["definition"]` returns a card's `dataset_query` or a transform's `source`, in the `mbql/query` shape).

## Joins and FK traversal

Two ways to read columns from a related table.

**Explicit join.** A stage's `joins` array holds join objects, each with three required keys: `stages` (the joined source as its own one-stage array carrying `source-table`/`source-card`), `conditions` (the ON clause — `[op, {}, leftRef, rightRef]`, slot-1 rule and all), and `alias` (the string name you address joined columns by). Optional `strategy` (`left-join` default; also `right-join` / `inner-join` / `full-join`) and `fields` (`"all"` | `"none"` | an array of refs — which joined columns to select). Reference a joined column anywhere downstream by putting **`join-alias`** in the field options:

```json
"joins": [
  {
    "alias": "Customers",
    "strategy": "left-join",
    "stages": [{ "lib/type": "mbql.stage/mbql", "source-table": 170 }],
    "conditions": [
      ["=", {}, ["field", {}, 1711], ["field", { "join-alias": "Customers" }, 1684]]
    ],
    "fields": "none"
  }
],
"breakout": [["field", { "join-alias": "Customers" }, 1682]]
```

Left ref is a column of the stage's own source (`1711` = orders.customer_id); the right ref carries `join-alias` and points at the joined table's key (`1684` = customers.id). Every later reference to a joined column (`1682` = customers.plan) needs that same `join-alias`. Stack multiple objects in `joins`, each with its own `alias`.

**Implicit FK join via `source-field`.** For a single-hop FK lookup, skip the join — put the FK column's id in the target field's `source-field` option and Metabase traverses the relationship:

```json
["field", { "source-field": 1711 }, 1682] // orders.customer_id → customers.plan
```

`source-field` is the **FK field id** (orders.customer_id); the third element is the **target field id** in the related table (customers.plan). Both come from `browse_data`'s `get_fields`. Use it for "show a column from the table this FK points at"; reach for an explicit join when you need a non-FK condition, a non-default strategy, or control over which joined columns return.

## Expressions: an array, not a map

`expressions` is an **array** of ordinary clauses, each naming itself with `lib/expression-name` in its options. Reference one from elsewhere in the same stage with `["expression", {}, "<name>"]`. Names must be unique within the stage.

```json
"expressions": [
  ["*", { "lib/expression-name": "line_total" }, ["field", {}, 1816], ["field", {}, 1817]]
],
"aggregation": [["sum", { "name": "revenue" }, ["expression", {}, "line_total"]]]
```

The legacy map form `"expressions": { "line_total": ["*", …] }` is rejected — `invalid type, got: {:line_total …}`.

Two traps:

- **`["field", {}, "line_total"]` is not an expression ref.** A `field` ref with a string third arg names the **previous stage's** output column and requires `base-type` (see below); aim it at an expression in its own stage and the server answers `:base-type missing required key`. Same stage → `expression`; previous stage → `field` + `base-type`.
- **An expression cannot contain an aggregation** (`non-aggregation expression`). Aggregate the expression instead — `["sum", {}, ["expression", {}, "line_total"]]`, not an expression wrapping a `sum`.

## Multi-stage pipelines

Stages run in order; each reads the **previous stage's output columns** — the breakouts and aggregations it produced — referenced by **string name + `base-type`**, not a numeric field id. Only the first stage takes a `source-table`/`source-card`. Add a stage to operate on an aggregate (you can't filter or order by an aggregation within the stage that computes it): aggregate, then filter the aggregate, then order + limit.

```json
"stages": [
  { "lib/type": "mbql.stage/mbql", "source-table": 175,
    "aggregation": [["sum", { "name": "total" }, ["field", {}, 1715]]],
    "breakout": [["field", {}, 1711]] },
  { "lib/type": "mbql.stage/mbql",
    "filters": [[">", {}, ["field", { "base-type": "type/BigInteger" }, "total"], 0]] },
  { "lib/type": "mbql.stage/mbql",
    "order-by": [["desc", {}, ["field", { "base-type": "type/BigInteger" }, "total"]]],
    "limit": 3 }
]
```

Later stages address the first stage's aggregation by the `name` you gave it (`"total"`) — set that `name`, or the column lands as the default `sum` / `count` / … and you reference that string instead.

**Window functions** sit in `aggregation` next to ordinary aggregates. `offset` reads a value from another breakout row — month-over-month is `offset` of a sum by `-1` against a monthly breakout:

```json
"aggregation": [
  ["sum", { "name": "revenue" }, ["field", {}, 1715]],
  ["offset", { "name": "prev_month" }, ["sum", {}, ["field", {}, 1715]], -1]
],
"breakout": [["field", { "temporal-unit": "month" }, 1717]]
```

**Binning** is a breakout-level field option — bucket a numeric column into ranges with `["field", { "binning": { "strategy": "num-bins", "num-bins": 5 } }, 1715]`, the numeric counterpart to the `temporal-unit` bucket. Strategies (`num-bins` / `bin-width` / `default`) are in the operator reference.

## Naming aggregation output columns

Default aggregations materialize as `count`, `count_where`, `avg`, `avg_2`, `sum`, … — fine for an ad-hoc run, ugly for a transform target table or card column. Set `name` (the warehouse column name) and `display-name` (the UI header) in the aggregation's options:

```json
["count", { "name": "shipments_shipped", "display-name": "Shipments shipped" }]
```

## Operator reference

The full operator vocabulary — filter operators (`=`, `!=`, `<`, `between`, `contains`, `is-null`, …), aggregation functions (`count`, `sum`, `avg`, `distinct`, `count-where`, `share`, …), expression operators (arithmetic, string, temporal), temporal-bucketing units, and binning strategies — lives in `references/operators.md`, next to this file in the skill's directory, in numeric-id form. Read it on demand — before reaching for an operator you haven't used in this session, and whenever the server answers `not a known MBQL clause`.
