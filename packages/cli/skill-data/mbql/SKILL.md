---
name: mbql
description: Author and debug MBQL query bodies for the `mb` CLI — the query shape, clauses, filters, aggregation and breakout, order and limit, expressions, joins and FK columns, multi-stage pipelines, saved questions and definitions as sources, output column names, and the print-schema → dry-run → run loop. Use when writing or fixing any query body — `mb query`, a card's `dataset_query`, a transform's `source.query`, or a segment/measure `definition` — or when `--dry-run` or a run reports errors. Triggers — "write an MBQL query", "the dataset_query is wrong", "aggregate and group by", "join two tables", "month-over-month".
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

# MBQL

MBQL is the structured query format: portable across warehouse engines, and a card built on it wires to dashboard filters as-is. Write a structured query first; write native SQL (a `mbql.stage/native` stage, see `native-sql`) for window functions beyond `offset`, CTEs, set operations, engine-specific functions, or when asked for SQL.

Flag conventions, body input, output flags and `./.scratch` live in `core` (`mb skills get core`).

## The shape

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

- `database`, `source-table`, `source-card` and field ids are numeric, copied from `mb database list`, `mb table get <id> --include fields`, `mb card list`. A wrong id that exists resolves to the wrong column without an error, so copy ids, never guess them.
- The first stage names exactly one source: `source-table` (a table id) or `source-card` (a saved question or model id). Later stages name none; they read the previous stage's output columns.
- Stage keys: `joins`, `expressions`, `filters`, `aggregation`, `breakout`, `fields`, `order-by`, `limit`. Each list holds at least one clause.

## Clauses

Every clause is `[op, {options}, ...args]` with the options object at position 1, `{}` when there are none:

```json
["count", {}]
["sum", {}, ["field", {}, 42]]
["=", {}, ["field", {}, 61], "Gadget", "Widget"]
["field", { "temporal-unit": "month" }, 22]
```

An options key the server doesn't know is rejected or silently dropped, never applied, so spell keys exactly as written here. A field ref is `["field", {options}, <field id>]`. Its options: `temporal-unit` (bucket a date: `day`, `week`, `month`, `quarter`, `year`, …), `binning` (`{"strategy": "num-bins", "num-bins": 10}`), `join-alias` (a column of an explicit join), `source-field` (a column reached through an FK), `base-type` (on a column named by string, see Multi-stage).

## Filters, aggregation, breakout

- `filters` are ANDed; OR is `["or", {}, a, b, …]`. Multi-value is `["in", {}, <field>, "a", "b"]` / `["not-in", …]`.
- Relative dates: `["time-interval", {}, <field>, -30, "day"]`, `["time-interval", {}, <field>, "current", "month"]`. A stated year or date range is absolute: `["between", {}, <field>, "2024-01-01", "2024-12-31"]` (inclusive).
- `aggregation` is a list of aggregation clauses, `breakout` a list of refs. "only / where X" is a filter; "by / per / over time" is a breakout.
- Name every aggregation a later stage, a chart setting or a target table reads: `["sum", {"name": "revenue", "display-name": "Revenue"}, <field>]`. Unnamed, it is `count`, `sum`, `avg`, … and a second `sum` is `sum_2`.
- An aggregation can be arithmetic over aggregations: `["/", {"name": "aov"}, ["sum", {}, <field>], ["count", {}]]`.
- Date arithmetic is `["datetime-diff", {}, a, b, "day"]`.

## Order and limit

`order-by` holds `["asc", {}, <ref>]` / `["desc", {}, <ref>]`. To order by an aggregation of the same stage, set a `lib/uuid` from `mb uuid --format text` (the bare value) in that aggregation's options and point the ref at the same string:

```json
"aggregation": [["count", {}], ["sum", {"name": "revenue", "lib/uuid": "<uuid>"}, ["field", {}, 40]]],
"breakout": [["field", {}, 43]],
"order-by": [["desc", {}, ["aggregation", {}, "<uuid>"]]],
"limit": 10
```

A query read back from Metabase carries a `lib/uuid` on every clause, and each must be unique within the query: drop it from a clause you duplicate.

"Top / first / latest N" is `order-by` plus `limit: N` in the stage.

## Expressions

`expressions` is a list of clauses, each named by `lib/expression-name` in its options; `["expression", {}, "<name>"]` uses one in the same stage:

```json
"expressions": [["+", {"lib/expression-name": "Subtotal"}, ["field", {}, 40], ["field", {}, 44]]],
"aggregation": [["sum", {}, ["expression", {}, "Subtotal"]]]
```

## Joins

**A column of an FK-related table:** put the FK column's id in `source-field` and the related table's column id third. The join is added for you:

```json
["field", { "source-field": 1711 }, 1682]
```

(`1711` = orders.customer_id, `1682` = customers.plan.)

**An explicit join** for a non-FK condition, a chosen strategy, or a joined source question:

```json
"joins": [
  {
    "alias": "Customers",
    "strategy": "left-join",
    "stages": [{ "lib/type": "mbql.stage/mbql", "source-table": 170 }],
    "conditions": [["=", {}, ["field", {}, 1711], ["field", { "join-alias": "Customers" }, 1684]]],
    "fields": "all"
  }
],
"breakout": [["field", { "join-alias": "Customers" }, 1682]]
```

- `alias`, `stages` and `conditions` are required; `strategy` is `left-join` (default), `inner-join`, `right-join` or `full-join`.
- `fields` picks the joined columns a row listing returns: `"all"`, or a list of refs. Without it the join adds none.
- In the join's stage, every ref to a joined column carries `join-alias`, conditions included. A later stage reads it by name, like any earlier-stage column.

## Multi-stage

A later stage reads the previous stage's output by column name, with the column's `base-type`: `["field", {"base-type": "type/BigInteger"}, "count"]`. Filter on an aggregate (HAVING), or aggregate an aggregate, in the next stage:

```json
"stages": [
  { "lib/type": "mbql.stage/mbql", "source-table": 175,
    "aggregation": [["sum", { "name": "total" }, ["field", {}, 1715]]],
    "breakout": [["field", {}, 1711]] },
  { "lib/type": "mbql.stage/mbql",
    "filters": [[">", {}, ["field", { "base-type": "type/Float" }, "total"], 1000]],
    "order-by": [["desc", {}, ["field", { "base-type": "type/Float" }, "total"]]],
    "limit": 3 }
]
```

The names and base types are the `name` and `base_type` of the columns the earlier stages return: run them once (`mb query … --json`, `data.cols`) and copy both. A breakout keeps its field's name (`CREATED_AT`, even when bucketed); an aggregation has the `name` you gave it.

**Window:** `offset` sits in `aggregation` and reads another breakout row. Month-over-month against a monthly breakout:

```json
"aggregation": [
  ["sum", { "name": "revenue" }, ["field", {}, 1715]],
  ["offset", { "name": "prev_month" }, ["sum", {}, ["field", {}, 1715]], -1]
],
"breakout": [["field", { "temporal-unit": "month" }, 1717]]
```

## Saved questions, models and definitions

- A saved question or model is a source: `"source-card": 137` on the first stage, same database as the rest of the query; its columns go by name with `base-type`, as in a later stage.
- A metric is an aggregation: `["metric", {}, <card id>]`, on a stage whose source is the metric's table.
- A segment is a filter: `["segment", {}, <segment id>]`, on its table.
- A metric's output column is named for its inner aggregation (`sum`, `count`); set `"name"` in its options for a later stage to read it by.

<!-- requires: measures -->

A measure is an aggregation, `["measure", {}, <measure id>]`, on its table, and is named like a metric.

<!-- /requires -->

## Authoring loop: print-schema → dry-run → run

```bash
mb query --file q.json --dry-run --profile <n>        # check + compile on the server, no run
mb query --file q.json --profile <n> --json           # check + run
mb query --print-schema --profile <n> > ./.scratch/mbql-schema.json   # the full JSON Schema
mb query --file q.json --compile --profile <n>        # the SQL the server generates
mb query --file q.json --metadata --profile <n> --json   # tables (with FK targets), fields, snippets it touches
mb query --file q.json --export-format csv --profile <n> > rows.csv   # stream the rows up to the server's download limit, no envelope cap
```

- `--dry-run` checks the shape locally, then has the server compile the query to SQL without running it. It answers `{ ok, errors: [{ path, message }], sql }`: exit `0` with the compiled `sql`, or exit `2` with `sql: null` when either check rejects the body. A local error's `path` is a JSON Pointer into the body; a server error's is `""`. Exit `1` means the compile could not run (the server refused permission, server unreachable).
- The server compile catches what the shape check cannot: a ref to a missing aggregation or expression, an unknown clause, a duplicate `lib/uuid`, a missing table, field, card or segment, a raw-variable template tag with no value or `default` outside an optional `[[ ]]` clause, a `required` tag with no value. A column's type not suiting its operator and a misspelled column name in a later stage are caught only by the warehouse, so a mistake there compiles and fails on the run. When a run fails, read the message and fix the body it names; an error naming nothing in the body (a `NullPointerException`) is a server fault, so stop editing a body that is otherwise correct.
- A run checks the shape first and never sends an invalid body; exit `1` is a server or warehouse error after that.
- A server error `lib/uuid: missing required key` at a clause means that clause's arguments are wrong: their count, a unit it doesn't take, a bad time zone.
- `--compile` shows what a clause becomes: read the SQL when an aggregation, join or temporal bucket misbehaves, or seed a native query from a working body (`--no-pretty --format text` prints it bare). It needs native query permission on the database, and its SQL leaves out the row limit a run adds. `--metadata` shows what a body reaches before running it: every source table with its columns, the tables their foreign keys point at, and the fields and snippets a native body's template tags name. Both pre-flight the body like a run; `--dry-run`, `--compile`, `--metadata` and `--export-format` are mutually exclusive.
- A csv or xlsx export of a pivot passes `--pivot-results` with `--visualization-settings '{"pivot_table.column_split":{"rows":[…],"columns":[…],"values":[…]}}'`, naming the body's breakout and aggregation columns; an ad-hoc query has no card to take the layout from.
- A run answers `data.rows` and slim `data.cols` (`name`, `display_name`, `base_type`, `semantic_type`); `--full` returns the raw `/api/dataset` envelope.

## Where the query goes

Every command below takes the query object itself at the path shown, checked by the same pre-flight (`--skip-validate` sends it unchecked).

| Command                                 | The query lives at                             | Notes                             |
| --------------------------------------- | ---------------------------------------------- | --------------------------------- |
| `mb query`                              | the whole body                                 | ad-hoc run                        |
| `card create` / `card update`           | `dataset_query`                                |                                   |
| `transform create` / `transform update` | `source.query` (when `source.type` is `query`) | materializes to a warehouse table |
| `measure create` / `measure update`     | `definition`                                   | see below                         |
| `segment create` / `segment update`     | `definition`                                   | see below                         |

A measure `definition` is one stage with `source-table` and exactly one `aggregation` that references no metric, and no `joins`, `expressions`, `breakout`, `filters`, `fields`, `order-by` or `limit`. A segment `definition` is one stage with `source-table` and at least one `filters` clause, and no `joins`, `expressions`, `breakout`, `aggregation`, `order-by` or `limit`.

## Operator reference

Every filter, aggregation, expression, temporal unit and binning strategy, with arguments: `references/operators.md` (`mb skills get mbql --full`, or `mb skills path mbql` and read the file).
