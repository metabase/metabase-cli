# MBQL operator reference

The complete clause vocabulary the server accepts, in numeric-id form. The clause
_structure_ and the slot-1-options rule are in the SKILL.md body — this file is the
catalog of which operators exist and their arguments.

**Reading the tables.** Every clause is `[op, {options}, ...args]`. Below, `{…}`
abbreviates the slot-1 options object — usually empty (`{}`), since the server mints
every `lib/uuid` and you MUST NOT write one (see the SKILL body). It carries a value
only when noted: an operator-specific option named in the row.
Field refs are numeric: `["field", {…}, <field-id>]`,
the ids coming from `browse_data`'s `get_fields`. When two readings of a row are
possible, run the query with `execute_query` — the server is the authority.

**Contents**

- [Filter operators](#filter-operators) — Logical, Comparison, Null/empty, String match, Temporal, Segment
- [Aggregation functions](#aggregation-functions) — including naming and the `offset` window function
- [Expression operators](#expression-operators) — Arithmetic, Math, String, Temporal, Type conversion, Conditional
- [References (within clauses)](#references-within-clauses) — field, expression, aggregation
- [Field option: temporal bucketing](#field-option-temporal-bucketing)
- [Field option: binning](#field-option-binning)

> For relative date filters, prefer **`time-interval`** / **`relative-time-interval`**
> (below). `relative-datetime` / `absolute-datetime` literals (e.g. from a UI-built
> query) also work.

---

## Filter operators

A stage's `filters` is a list of boolean clauses, implicitly ANDed. Nest an explicit
`["or", {…}, …]` for OR.

### Logical

| Op    | Args               | Notes                                                 |
| ----- | ------------------ | ----------------------------------------------------- |
| `and` | 2+ boolean clauses | Logical AND (usually implicit via the `filters` list) |
| `or`  | 2+ boolean clauses | Logical OR                                            |
| `not` | 1 boolean clause   | Logical NOT                                           |

### Comparison

| Op                | Args                                                     | Notes                   |
| ----------------- | -------------------------------------------------------- | ----------------------- |
| `=`               | field, 1+ values                                         | Multi-value = IN        |
| `!=`              | field, 1+ values                                         | Multi-value = NOT IN    |
| `<` `>` `<=` `>=` | 2 orderable                                              |                         |
| `between`         | field, min, max                                          | Inclusive               |
| `inside`          | lat-field, lon-field, lat-max, lon-min, lat-min, lon-max | Geographic bounding box |

```json
["between", {…}, ["field", {…}, 12], 10, 100]
["=", {…}, ["field", {…}, 7], "Widget", "Gadget"]
```

### Null / empty

| Op          | Args                | Notes                 |
| ----------- | ------------------- | --------------------- |
| `is-null`   | 1 expression        |                       |
| `not-null`  | 1 expression        |                       |
| `is-empty`  | 1 string expression | NULL or `""`          |
| `not-empty` | 1 string expression | not NULL and not `""` |

### String match

N-ary (multiple values OR'd). Accept a `case-sensitive` option (default `true`) in the
options object.

| Op                 | Args              |
| ------------------ | ----------------- |
| `contains`         | field, 1+ strings |
| `does-not-contain` | field, 1+ strings |
| `starts-with`      | field, 1+ strings |
| `ends-with`        | field, 1+ strings |

```json
["contains", { "case-sensitive": false }, ["field", {…}, 9], "widget"]
```

### Temporal

| Op                       | Args                                                       | Notes                                               |
| ------------------------ | ---------------------------------------------------------- | --------------------------------------------------- |
| `time-interval`          | temporal-field, n, unit                                    | `n` = integer, or `"current"` / `"last"` / `"next"` |
| `relative-time-interval` | temporal-field, value, bucket, offset-value, offset-bucket | interval with offset                                |

Units (truncation only): `millisecond`, `second`, `minute`, `hour`, `day`, `week`,
`month`, `quarter`, `year`.

```json
["time-interval", {…}, ["field", {…}, 22], -30, "day"]      // last 30 days
["time-interval", {…}, ["field", {…}, 22], "current", "month"]
```

### Segment

| Op        | Args       | Notes                     |
| --------- | ---------- | ------------------------- |
| `segment` | segment id | Reference a saved segment |

---

## Aggregation functions

A stage's `aggregation` is a list of aggregation clauses.

| Op                      | Args                       | Notes                            |
| ----------------------- | -------------------------- | -------------------------------- |
| `count`                 | none, or 1 expression      | with arg: count non-NULL         |
| `sum` `avg` `min` `max` | 1 numeric/orderable        |                                  |
| `distinct`              | 1 expression               | count of distinct values         |
| `cum-count`             | none or 1 expression       | running count                    |
| `cum-sum`               | 1 numeric                  | running sum                      |
| `stddev` `var` `median` | 1 numeric                  |                                  |
| `percentile`            | numeric, p (0.0–1.0)       |                                  |
| `count-where`           | 1 boolean clause           |                                  |
| `sum-where`             | numeric, boolean clause    |                                  |
| `distinct-where`        | expression, boolean clause |                                  |
| `share`                 | 1 boolean clause           | proportion 0–1                   |
| `metric`                | metric id                  | reference a saved metric card    |
| `measure`               | measure id                 | reference a saved measure (v59+) |

```json
["count", {…}]
["sum", {…}, ["field", {…}, 42]]
["count-where", {…}, [">", {…}, ["field", {…}, 42], 100]]
```

**Naming** — set `name` (warehouse column) and/or `display-name` (UI header) in the
options object: `["sum", { "name": "revenue", "display-name": "Revenue" }, …]`.

**Window function** — `offset` is only valid inside `aggregation`:

| Op       | Args          | Notes                                             |
| -------- | ------------- | ------------------------------------------------- |
| `offset` | expression, n | value n rows before (negative) / after (positive) |

---

## Expression operators

Used in `expressions` (named, via `lib/expression-name` in options) and inline.

### Arithmetic

| Op  | Args                               | Notes                |
| --- | ---------------------------------- | -------------------- |
| `+` | 2+ numeric, or temporal + interval |                      |
| `-` | 1+ numeric, or temporal − interval | unary = negation     |
| `*` | 2+ numeric                         |                      |
| `/` | 2+ numeric                         | always returns float |

### Math

| Op                           | Args           |
| ---------------------------- | -------------- |
| `abs` `ceil` `floor` `round` | 1 numeric      |
| `power`                      | base, exponent |
| `sqrt` `exp` `log`           | 1 numeric      |

### String

| Op                                 | Args                            |
| ---------------------------------- | ------------------------------- |
| `concat`                           | 2+ expressions                  |
| `substring`                        | str, start (1-indexed), length? |
| `replace`                          | str, find, replace              |
| `regex-match-first`                | str, regex                      |
| `split-part`                       | str, delimiter, position        |
| `trim` `ltrim` `rtrim`             | 1 string                        |
| `upper` `lower`                    | 1 string                        |
| `length`                           | 1 string                        |
| `host` `domain` `subdomain` `path` | 1 URL string                    |

### Temporal

| Op                                                                                  | Args                            | Notes                      |
| ----------------------------------------------------------------------------------- | ------------------------------- | -------------------------- |
| `now`                                                                               | none                            | datetime                   |
| `today`                                                                             | none                            | date                       |
| `interval`                                                                          | amount, unit                    | a temporal interval        |
| `datetime-add`                                                                      | temporal, amount, unit          |                            |
| `datetime-subtract`                                                                 | temporal, amount, unit          |                            |
| `datetime-diff`                                                                     | datetime1, datetime2, unit      |                            |
| `convert-timezone`                                                                  | temporal, target-tz, source-tz? |                            |
| `get-year` `get-quarter` `get-month` `get-day` `get-hour` `get-minute` `get-second` | 1 temporal                      | integer component          |
| `get-day-of-week`                                                                   | temporal, mode?                 | mode `iso`/`us`/`instance` |
| `get-week`                                                                          | temporal, mode?                 | mode `iso`/`us`/`instance` |
| `temporal-extract`                                                                  | temporal, unit, mode?           | generic extraction         |
| `month-name` `quarter-name` `day-name`                                              | 1 integer                       | name from number           |

Add/subtract/interval units: `year`, `quarter`, `month`, `week`, `day`, `hour`,
`minute`, `second`, `millisecond`. `datetime-diff` units: same minus `millisecond`.
`temporal-extract` units: `year-of-era`, `quarter-of-year`, `month-of-year`,
`week-of-year-iso`, `week-of-year-us`, `week-of-year-instance`, `day-of-month`,
`day-of-week`, `day-of-week-iso`, `hour-of-day`, `minute-of-hour`, `second-of-minute`.

### Type conversion

| Op        | Args              |
| --------- | ----------------- |
| `integer` | string or numeric |
| `float`   | string            |
| `text`    | 1 expression      |

### Conditional

| Op         | Args                           | Notes                                                |
| ---------- | ------------------------------ | ---------------------------------------------------- |
| `case`     | `[[cond, value], …]`, default? | if/then/else; default is the trailing positional arg |
| `if`       | same as `case`                 | alias for `case`                                     |
| `coalesce` | 2+ expressions                 | first non-null                                       |

```json
["case", { "lib/expression-name": "Tier" },
  [[[">", {…}, ["field", {…}, 14], 100], "Premium"],
   [["<=", {…}, ["field", {…}, 14], 20], "Budget"]],
  "Standard"]
```

(`case`'s first arg is a list of `[condition, value]` pairs; the optional 4th
positional arg is the default.)

---

## References (within clauses)

| Ref         | Shape                                | Notes                                                                          |
| ----------- | ------------------------------------ | ------------------------------------------------------------------------------ |
| field       | `["field", {…}, <field-id>]`         | numeric id; options may carry `base-type`, `temporal-unit`, `binning`          |
| expression  | `["expression", {…}, "<name>"]`      | by the expression's `lib/expression-name` string                               |
| aggregation | `["aggregation", {…}, "<agg-uuid>"]` | needs a `lib/uuid` you are not allowed to invent — don't write this ref. To sort or filter an aggregate, add a stage and address it by `name` + `base-type` |

## Field option: temporal bucketing

`temporal-unit` in a field ref's options buckets a datetime.

- Truncation: `default`, `millisecond`, `second`, `minute`, `hour`, `day`, `week`,
  `month`, `quarter`, `year`.
- Extraction (returns an integer): `minute-of-hour`, `hour-of-day`, `day-of-week`,
  `day-of-month`, `day-of-year`, `week-of-year`, `month-of-year`, `quarter-of-year`,
  `year-of-era`, `second-of-minute`. (The `*-iso`/`*-us` variants are `temporal-extract`
  operator modes, not field-option bucketing units.)

```json
["field", { "temporal-unit": "month" }, 22]
```

## Field option: binning

`binning` in a field ref's options groups a numeric/coordinate column.

| `strategy`  | Extra property       | Notes                            |
| ----------- | -------------------- | -------------------------------- |
| `num-bins`  | `num-bins` (integer) | fixed number of equal-width bins |
| `bin-width` | `bin-width` (number) | fixed bin width                  |
| `default`   | —                    | Metabase chooses                 |

```json
["field", { "binning": { "strategy": "num-bins", "num-bins": 10 } }, 14]
```
