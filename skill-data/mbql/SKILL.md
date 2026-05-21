---
name: mbql
description: Author Metabase MBQL 5 query bodies for the `mb` CLI — the only hand-authorable query format. Covers the JSON shape (lib/type mbql/query, flat stages, numeric ids), the "options object always second" clause rule, lib/uuid minting, the print-schema → dry-run → run validation loop, where MBQL 5 is consumed (mb query, card dataset_query, transform source.query, measure/segment definition), the flat-vs-legacy-envelope footgun, and naming aggregation output columns. Load whenever building or fixing an MBQL query by hand — "write an MBQL query", "create a card from MBQL", "the dataset_query is wrong", "fix the validation errors", "aggregate and group by", "order by the count", or any `--dry-run` / `mb query` work.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

# MBQL 5

MBQL 5 is the **only query format you can author by hand** with confidence — it has a bundled JSON Schema, so the CLI pre-flight-validates it before sending. Legacy MBQL 4 and native SQL are accepted but **not** schema-validated (see "Other formats" below).

Prefer MBQL over native SQL: MBQL is portable across warehouse engines and the CLI can validate it. Reach for native only when the query needs something MBQL can't express.

The general flag conventions, body-input precedence, and output flags live in the `core` skill (`mb skills get core`).

## The shape

A query is a flat object — `lib/type`, a numeric `database` id, and an ordered `stages` array. No recursive `source-query` nesting; multi-step queries are sibling stages.

```json
{
  "lib/type": "mbql/query",
  "database": 1,
  "stages": [
    {
      "lib/type": "mbql.stage/mbql",
      "source-table": 7,
      "aggregation": [["count", { "lib/uuid": "<mint via mb uuid>" }]],
      "breakout": [["field", { "temporal-unit": "month", "lib/uuid": "<mint>" }, 22]]
    }
  ]
}
```

- **Numeric ids only.** `database`, `source-table`, and field ids are integers from `mb database list` / `mb table get <id> --include fields`. (The portable YAML representation under git-sync uses _names_ like `[Sample Database, PUBLIC, ORDERS]`; the CLI's `/api/dataset` form uses numeric ids — don't mix them.)
- **First stage** carries `source-table` (a table id) or `source-card` (a saved card). Later stages omit both and read the previous stage's output columns by name.
- `source-card` references a saved card by entity id; downstream fields are referenced by column name (string), not a field id.

## The one rule that trips everyone: options object is **second**

Every clause is `[op, {options}, ...args]`. The options object is element **1**, args follow.

```json
["field", { "base-type": "type/Text", "lib/uuid": "<mint>" }, 1779]   // field id is THIRD
["count", { "lib/uuid": "<mint>" }]                                    // no args
["sum",   { "lib/uuid": "<mint>" }, ["field", { "lib/uuid": "<mint>" }, 42]]
["=",     { "lib/uuid": "<mint>" }, ["field", { "lib/uuid": "<mint>" }, 1779], "delivered"]
["asc",   { "lib/uuid": "<mint>" }, ["field", { "lib/uuid": "<mint>" }, 42]]
```

The legacy MBQL 4 field shape `["field", id, opts]` (id second) is **rejected** here. A slot-1 violation surfaces from `--dry-run` as `must be the field options object` / `must be the clause options object` at `/stages/0/<verb>/<n>/1`.

The same `[op, {options}, …]` rule holds for `aggregation`, `breakout` (a list of field refs), `filters` (implicitly ANDed; nest an explicit `["or", {}, …]` for OR), `order-by`, `expressions`, and join `conditions`.

## UUIDs: mint them, never invent them

Every clause options object carries a `lib/uuid` (UUID v4). The schema enforces RFC 4122 strictly, so placeholders (`"a1"`, `"uuid-1"`, `"agg-uuid-001"`) fail pre-flight with `must be a UUID v4 (RFC 4122) — run \`mb uuid\` …`. The same applies to native template-tag ids and any other `format: "uuid"` slot.

```bash
mb uuid --count 5 --json     # → ["…","…","…","…","…"] — mint exactly what you need, in one call
```

Workflow: count the slots (one per clause options object), `mb uuid --count <N> --json`, substitute each minted value as you build the JSON. Never copy a UUID from docs, a prior query, or another session.

**Aggregation/expression refs are the only legitimate reuse.** To reference an aggregation downstream (in `order-by` or a later stage), use `["aggregation", {options}, "<uuid>"]` where the third arg is the **string** `lib/uuid` of the target aggregation — the same minted value, by string equality. A numeric position fails with `must be the target aggregation's lib/uuid (string), not a numeric position`. Expression refs work the same way but key off the expression's name string.

```json
"aggregation": [["count", { "lib/uuid": "AGG_UUID" }]],
"order-by":   [["desc", { "lib/uuid": "ORDER_UUID" },
                 ["aggregation", { "lib/uuid": "REF_UUID" }, "AGG_UUID"]]]
```

(`AGG_UUID` appears twice and must be the _same_ minted value; `ORDER_UUID` and `REF_UUID` are distinct.)

## Authoring loop: print-schema → dry-run → run

`mb query` is the canonical authoring surface. Three modes:

```bash
mb query --print-schema --profile <n> > /tmp/mbql-schema.json   # 1. fetch the schema
mb query --file q.json --dry-run --profile <n>                  # 2. validate, no network
mb query --file q.json --profile <n> --json                     # 3. validate + run
```

- `--print-schema` emits `{ schema, defs }` where `defs` carries `id.yaml` / `parameter.yaml` / `ref.yaml` / `temporal_bucketing.yaml` keyed by the path used in the schema's `$ref`s. Read it first for any non-trivial query — cheaper than guess-and-fail.
- `--dry-run` validates and emits `{ ok, errors: [{ path, message }] }`. Exit `0` valid, `2` invalid. No request sent. Iterate until `ok: true`.
- run (no flag) validates, then on success sends to `/api/dataset`. On validation failure it writes the same envelope, exits `2`, and **never sends**.

`path` is a JSON Pointer into the body (`/stages/0/aggregation/0`); `message` is the validator error. Exit codes: `0` valid + ran, `2` validation failed / malformed body, `1` server-side error after a valid pre-flight.

`--skip-validate` bypasses the pre-flight and sends as-is — use only when the bundled schema disagrees with what the server actually accepts (drift / false negative). Mutually exclusive with `--dry-run`. The same flag exists on `card create/update` and `transform create/update`.

## Where MBQL 5 is consumed

The same body and the same pre-flight apply everywhere a query is embedded. Each pre-flights only when the value is MBQL 5 (`lib/type: "mbql/query"`); legacy shapes skip it; `--skip-validate` bypasses.

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
               "aggregation": [["count", { "lib/uuid": "<mint>" }]] }]
}
```

No `type:"query"` wrapper, no `query:` nesting. If you wrap MBQL 5 inside a legacy envelope the CLI rejects it pre-send with a `ConfigError` (no `--skip-validate` gets it past). If it ever reached the server it would store silently and fail at run time with `Initial MBQL stage must have either :source-table or :source-card`.

## Other formats skip pre-flight

Anything that is not `lib/type: "mbql/query"` is sent as-is and normalized server-side:

- **Legacy MBQL 4** — `{ "type": "query", "database": N, "query": { "source-table": T, … } }`
- **Native SQL** — `{ "type": "native", "database": N, "native": { "query": "SELECT …" } }`

`mb query --file probe.json` runs these directly; `--dry-run` on them returns `{ ok: true, errors: [] }`. Don't author MBQL 4 by hand — if you need a legacy or complex query, build it in the Metabase UI and pull the body with `mb card get <id> --full --json` / `mb transform get <id> --full --json`.

## Naming aggregation output columns

Default MBQL 5 aggregations materialize as `count`, `count_where`, `avg`, `avg_2`, `sum`, … — fine for an ad-hoc run, ugly when the output is a transform target table or a card column. Set `name` (becomes the warehouse column name) and `display-name` (the UI header) in the aggregation's options:

```json
[
  "count",
  { "lib/uuid": "<mint>", "name": "shipments_shipped", "display-name": "Shipments shipped" }
]
```

## Operator reference

The full operator vocabulary — filter operators (`=`, `!=`, `<`, `between`, `contains`, `is-null`, …), aggregation functions (`count`, `sum`, `avg`, `distinct`, `count-where`, `share`, …), expression operators (arithmetic, string, date), temporal-unit values, and binning strategies — is shared with the portable representation format. Load the `metabase-representation-format` skill's `spec.md` ("MBQL Query", "Filter Operators", "Aggregation Functions", "Expression Operators", "Temporal Bucketing", "Binning") for the complete list. The clause _structure_ there is identical to the CLI form; only the ids differ (representation uses table/field _names_, the CLI uses numeric ids).

## Don't

- Don't invent, hard-code, or copy `lib/uuid` values — `mb uuid` every slot at author time.
- Don't put the options object anywhere but slot 1, and don't use the legacy `["field", id, opts]` order.
- Don't wrap an MBQL 5 body in `{type:"query", query:…}` — `dataset_query` / `source.query` / `definition` is the flat `mbql/query`.
- Don't author MBQL 4 by hand — build it in the UI and pull it with `… get <id> --full --json`.
- Don't skip the `--dry-run` loop on a non-trivial query — it's free and exact.
