---
name: mbql
description: Author and debug MBQL 5 query bodies for the `mb` CLI — the only hand-authorable query format. Covers the JSON shape (flat numeric-id stages, options-object-second clauses, optional lib/uuid), joins and FK traversal, multi-stage pipelines, aggregation naming, the flat-vs-legacy-envelope footgun, and the print-schema → dry-run → run validation loop. Use when writing or fixing any query body — `mb query`, a card's `dataset_query`, a transform's `source.query`, or a segment/measure `definition` — or when `--dry-run`/run reports validation errors. Triggers — "write an MBQL query", "the dataset_query is wrong", "aggregate and group by", "join two tables", "month-over-month".
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

# MBQL 5

MBQL 5 is the **only query format you can author by hand** with confidence — it has a bundled JSON Schema, so the CLI pre-flight-validates it before sending. Legacy MBQL 4 and native SQL are accepted but **not** schema-validated (see "Other formats" below).

Prefer MBQL over native SQL: portable across warehouse engines and pre-flight-validated. Try it first; fall back to native SQL when MBQL can't express what you need, or when an MBQL body keeps failing server-side and you can't resolve it.

General flag conventions, body-input precedence, output flags, `./.scratch`, and `mb uuid` mechanics live in `core` (`mb skills get core`).

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

- **Numeric ids only.** `database`, `source-table`, and field ids are integers from `mb database list` / `mb table get <id> --include fields`. (Git-sync YAML uses _names_ like `[Sample Database, PUBLIC, ORDERS]`; the `/api/dataset` form uses numeric ids — don't mix them.)
- **First stage** carries `source-table` (a table id) or `source-card` (a saved card). Later stages omit both and read the previous stage's output columns by name.
- `source-card` references a saved card by its **numeric id** (from `mb card list`), not its string entity id; downstream fields are referenced by column name (string), not a field id.

## The one rule that trips everyone: options object is **second**

Every clause is `[op, {options}, ...args]`. The options object is element **1**, args follow.

```json
["field", { "base-type": "type/Text" }, 1779]   // field id is THIRD; options may be empty {}
["count", {}]                                    // no args
["sum",   {}, ["field", {}, 42]]
["=",     {}, ["field", {}, 1779], "delivered"]
["asc",   {}, ["field", {}, 42]]
```

The legacy MBQL 4 field shape `["field", id, opts]` (id second) is **rejected** here. A slot-1 violation surfaces from `--dry-run` as `must be the field options object` / `must be the clause options object` at `/stages/0/<verb>/<n>/1`.

The same `[op, {options}, …]` rule holds for `aggregation`, `breakout` (a list of field refs), `filters` (implicitly ANDed; nest an explicit `["or", {}, …]` for OR), `order-by`, `expressions`, and join `conditions`.

## UUIDs: optional — mint only to reference a clause

`lib/uuid` is **optional — leave it out whenever you can.** Omit it and the server generates a unique one for every clause; an empty options object `{}` is the normal case. The more UUIDs you hand-manage the easier it is to trip the server's "all `lib/uuid`s must be unique" check — a duplicated UUID passes pre-flight, then fails server-side.

Set an explicit `lib/uuid` only when you must **reference a clause from elsewhere in the query** — you have to know the value to point at. The case that needs it: **ordering by (or otherwise reusing) an aggregation.** `["aggregation", {…}, "<uuid>"]`'s third arg is the **string** `lib/uuid` of the target aggregation, so give that aggregation an explicit `lib/uuid` and point the ref at the same string. A numeric position fails with `must be the target aggregation's lib/uuid (string), not a numeric position`.

```json
"aggregation": [["count", { "lib/uuid": "AGG_UUID" }]],
"order-by":   [["desc", {}, ["aggregation", {}, "AGG_UUID"]]]
```

(`AGG_UUID` is both the aggregation's own `lib/uuid` and the string the ref points at — one value, by string equality. Every other clause omits its UUID. Expression refs work the same way but key off the expression's `lib/expression-name` string, so expressions rarely need an explicit `lib/uuid`.)

When you do need one, **always mint it with `mb uuid` — never write, guess, or copy a UUID yourself.** A hand-authored value is rejected pre-flight as not-a-v4 (`"a1"`, `"uuid-1"`, `"agg-uuid-001"` → ``must be a UUID v4 (RFC 4122) — run `mb uuid` ``), or if it looks valid risks colliding with another clause. Mint just the few you reference (`mb uuid --count 2 --json`; this also covers native template-tag ids and any other `format: "uuid"` slot).

## Authoring loop: print-schema → dry-run → run

`mb query` is the canonical authoring surface. Three modes:

```bash
mb query --print-schema --profile <n> > ./.scratch/mbql-schema.json   # 1. fetch the schema
mb query --file q.json --dry-run --profile <n>                  # 2. validate, no network
mb query --file q.json --profile <n> --json                     # 3. validate + run
```

- `--print-schema` emits `{ schema, defs }` where `defs` carries `id.yaml` / `parameter.yaml` / `ref.yaml` / `temporal_bucketing.yaml` keyed by the path used in the schema's `$ref`s. Read it first for any non-trivial query — cheaper than guess-and-fail.
- `--dry-run` validates and emits `{ ok, errors: [{ path, message }] }`. Exit `0` valid, `2` invalid. No request sent. Iterate until `ok: true`.
- run (no flag) validates, then on success sends to `/api/dataset`. On validation failure it writes the same envelope, exits `2`, and **never sends**.

`path` is a JSON Pointer into the body (`/stages/0/aggregation/0`); `message` is the validator error. Exit codes: `0` valid + ran, `2` validation failed / malformed body, `1` server-side error after a valid pre-flight.

**Pre-flight is a lightweight shape check, not the full backend validator.** It checks JSON shape, `lib/uuid` format, and enum values — not operator names, the first-stage source rule, or whether a reference resolves. A clean `--dry-run` is necessary but not sufficient: a body can pass pre-flight and still fail on the server (exit `1`). The server is the authority — when a run fails, read its error and fix the body. Common ones:

- `not a known MBQL clause` → a misspelled or unsupported **operator**. Check the vocabulary in `operators.md` (`mb skills get mbql --full`).
- `Initial MBQL stage must have either :source-table or :source-card` → the **first stage** is missing its source (a numeric table or card id); only the first stage takes one, later stages read the previous stage's columns.
- `Invalid :expression reference: no expression named "X"` (or an invalid `:aggregation` reference) → a **ref** points to an expression name / aggregation `lib/uuid` that isn't defined in the query; fix the target string.
- `Duplicate :lib/uuid` → you reused a `lib/uuid`. Omit them (the server mints unique ones) or give each clause a distinct value.

A successful run emits the compact envelope by default: `data.rows` + slim `data.cols` (`name`, `display_name`, `base_type`, `semantic_type`). Pass `--full` for the raw `/api/dataset` envelope (`results_metadata`, `native_form`, per-column fingerprints/`field_ref`) only when you need that metadata; `--fields data.rows` narrows to rows alone. `mb query` also runs a **native** body — `{database, type:"native", native:{query:"SELECT …"}}` — which skips pre-flight; the quickest way to eyeball warehouse data.

`--skip-validate` bypasses pre-flight and sends as-is — use only when the bundled schema disagrees with what the server actually accepts (drift / false negative). Mutually exclusive with `--dry-run`. Same flag exists on `card create/update` and `transform create/update`.

## Where MBQL 5 is consumed

The same body and pre-flight apply everywhere a query is embedded. Each pre-flights only when the value is MBQL 5 (`lib/type: "mbql/query"`); legacy shapes skip it; `--skip-validate` bypasses.

| Command                                 | MBQL 5 lives at                                | Notes                                       |
| --------------------------------------- | ---------------------------------------------- | ------------------------------------------- |
| `mb query`                              | the whole body                                 | ad-hoc run against `/api/dataset`           |
| `card create` / `card update`           | `dataset_query`                                | a **flat** `mbql/query` — see footgun below |
| `transform create` / `transform update` | `source.query` (when `source.type` is `query`) | materializes to a warehouse table           |
| `measure create` / `measure update`     | `definition`                                   | exactly one `aggregation`, no `filters`     |
| `segment create` / `segment update`     | `definition`                                   | filter macro tied to a table                |

## Footgun: `dataset_query` is the flat mbql/query, not a legacy envelope

The most common mistake. The legacy MBQL 4 shape `{ "type": "query", "database": N, "query": {…} }` looks similar but is wrong for MBQL 5. `dataset_query` (and `source.query`, and `definition`) **is the `mbql/query` value itself**:

```json
"dataset_query": {
  "lib/type": "mbql/query",
  "database": 2,
  "stages": [{ "lib/type": "mbql.stage/mbql", "source-table": 190,
               "aggregation": [["count", {}]] }]
}
```

No `type:"query"` wrapper, no `query:` nesting. If you wrap MBQL 5 inside a legacy envelope the CLI rejects it pre-send with a `ConfigError` (no `--skip-validate` gets it past). If it reached the server it would store silently and fail at run time with `Initial MBQL stage must have either :source-table or :source-card`.

## Other formats skip pre-flight

Anything not `lib/type: "mbql/query"` is sent as-is and normalized server-side:

- **Legacy MBQL 4** — `{ "type": "query", "database": N, "query": { "source-table": T, … } }`
- **Native SQL** — `{ "type": "native", "database": N, "native": { "query": "SELECT …" } }`

`mb query --file probe.json` runs these directly; `--dry-run` on them returns `{ ok: true, errors: [] }`. Don't author MBQL 4 by hand — build a legacy or complex query in the Metabase UI and pull the body with `mb card get <id> --full --json` / `mb transform get <id> --full --json`.

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

`source-field` is the **FK field id** (orders.customer_id); the third element is the **target field id** in the related table (customers.plan). Use it for "show a column from the table this FK points at"; reach for an explicit join when you need a non-FK condition, a non-default strategy, or control over which joined columns return.

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

Default MBQL 5 aggregations materialize as `count`, `count_where`, `avg`, `avg_2`, `sum`, … — fine for an ad-hoc run, ugly for a transform target table or card column. Set `name` (the warehouse column name) and `display-name` (the UI header) in the aggregation's options:

```json
["count", { "name": "shipments_shipped", "display-name": "Shipments shipped" }]
```

## Operator reference

The full operator vocabulary — filter operators (`=`, `!=`, `<`, `between`, `contains`, `is-null`, …), aggregation functions (`count`, `sum`, `avg`, `distinct`, `count-where`, `share`, …), expression operators (arithmetic, string, temporal), temporal-bucketing units, and binning strategies — lives in this skill's `references/operators.md`, in numeric-id form. Load it on demand rather than dumping the schema:

```bash
mb skills get mbql --full     # appends references/operators.md to this body
mb skills path mbql           # → the skill dir; then Read references/operators.md
```

`mb query --print-schema` is the exhaustive-but-heavy fallback (the full JSON Schema, ~1600 lines). The cheat-sheet covers the vocabulary; the `--dry-run` loop settles any disagreement.
