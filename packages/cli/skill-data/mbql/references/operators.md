# MBQL operator catalog

Every clause is `[op, options, ...args]`; options is `{}` unless a row names an option. `F` below is a field ref such as `[field, {}, [Sample Database, PUBLIC, ORDERS, TOTAL]]`. The spec's **Filter Operators**, **Aggregation Functions**, and **Expression Operators** sections have a YAML example for each operator.

## Filters (in `filters`, implicitly ANDed)

| Op                                                      | Args                                             | Notes                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `and` `or`                                              | 2+ boolean clauses                               | put `or` in `filters` for OR logic                                                          |
| `not`                                                   | 1 boolean clause                                 |                                                                                             |
| `=` `!=`                                                | F, 1+ values                                     | several values = IN / NOT IN                                                                |
| `<` `>` `<=` `>=`                                       | 2 orderable                                      |                                                                                             |
| `between`                                               | F, min, max                                      | inclusive                                                                                   |
| `inside`                                                | lat F, lon F, lat-max, lon-min, lat-min, lon-max | bounding box                                                                                |
| `is-null` `not-null`                                    | F                                                |                                                                                             |
| `is-empty` `not-empty`                                  | string F                                         | NULL or `""`                                                                                |
| `contains` `does-not-contain` `starts-with` `ends-with` | F, 1+ strings                                    | option `case-sensitive` (default `true`); several values are ORed                           |
| `time-interval`                                         | F, n, unit                                       | `n` is an integer (`-30` = last 30), `current`, `last`, or `next`; option `include-current` |
| `relative-time-interval`                                | F, n, unit, offset-n, offset-unit                | e.g. last 30 days, shifted back 1 month                                                     |
| `segment`                                               | segment entity_id                                |                                                                                             |

`time-interval` units: `millisecond` `second` `minute` `hour` `day` `week` `month` `quarter` `year`.

## Aggregations (in `aggregation`)

| Op                      | Args                  | Notes                                                                  |
| ----------------------- | --------------------- | ---------------------------------------------------------------------- |
| `count`                 | none, or F            | with F: non-NULL count                                                 |
| `sum` `avg` `min` `max` | F                     |                                                                        |
| `distinct`              | F                     | distinct count                                                         |
| `cum-count`             | none, or F            | running count                                                          |
| `cum-sum`               | F                     | running sum                                                            |
| `stddev` `var` `median` | numeric F             |                                                                        |
| `percentile`            | F, p                  | p in 0.0 to 1.0                                                        |
| `count-where`           | boolean clause        |                                                                        |
| `sum-where`             | F, boolean clause     |                                                                        |
| `distinct-where`        | F, boolean clause     |                                                                        |
| `share`                 | boolean clause        | fraction of rows, 0 to 1                                               |
| `offset`                | aggregation clause, n | window function; valid only in `aggregation`; negative n = earlier row |
| `metric`                | metric card entity_id |                                                                        |
| `measure`               | measure entity_id     |                                                                        |

Options `name` (column name) and `display-name` (header) apply to any aggregation.

## Expressions (in `expressions`, named by option `lib/expression-name`)

| Group       | Ops                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Arithmetic  | `+` `-` `*` (2+ args; unary `-` negates), `/` (always float). `+`/`-` also add an `interval` to a datetime.                                                                                                                                                                                                                                                                                                  |
| Math        | `abs` `ceil` `floor` `round` `sqrt` `exp` `log` (1 arg), `power` (base, exponent)                                                                                                                                                                                                                                                                                                                            |
| String      | `concat` (2+), `substring` (str, start 1-based, length?), `replace` (str, find, replacement), `regex-match-first` (str, regex), `split-part` (str, delimiter, position), `trim` `ltrim` `rtrim` `upper` `lower` `length`, `host` `domain` `subdomain` `path` (URL)                                                                                                                                           |
| Temporal    | `now` `today` (no args), `interval` (n, unit), `datetime-add` / `datetime-subtract` (dt, n, unit), `datetime-diff` (dt1, dt2, unit), `convert-timezone` (dt, target-tz, source-tz?), `get-year` `get-quarter` `get-month` `get-day` `get-hour` `get-minute` `get-second`, `get-day-of-week` / `get-week` (dt, mode?), `temporal-extract` (dt, unit, mode?), `month-name` `quarter-name` `day-name` (integer) |
| Conversion  | `integer` (string or number), `float` (string), `text` (any)                                                                                                                                                                                                                                                                                                                                                 |
| Conditional | `case` / `if` ([[cond, value], ...], default?), `coalesce` (2+)                                                                                                                                                                                                                                                                                                                                              |

- `mode`: `iso`, `us`, or `instance`.
- `datetime-diff` units: `year` `quarter` `month` `week` `day` `hour` `minute` `second`. The add and subtract units also allow `millisecond`.
- `temporal-extract` units: `year-of-era` `quarter-of-year` `month-of-year` `week-of-year-iso` `week-of-year-us` `week-of-year-instance` `day-of-month` `day-of-week` `day-of-week-iso` `hour-of-day` `minute-of-hour` `second-of-minute`.

`case` takes a list of `[condition, value]` pairs, then an optional default:

```yaml
expressions:
  - - case
    - lib/expression-name: Tier
    - - - [">", {}, [field, {}, [Sample Database, PUBLIC, ORDERS, TOTAL]], 100]
        - Premium
      - - ["<=", {}, [field, {}, [Sample Database, PUBLIC, ORDERS, TOTAL]], 20]
        - Budget
    - Standard
```

## Field options: bucketing and binning

- `temporal-unit` truncation: `default` `millisecond` `second` `minute` `hour` `day` `week` `month` `quarter` `year`.
- `temporal-unit` extraction (returns an integer): `minute-of-hour` `hour-of-day` `day-of-week` `day-of-week-iso` `day-of-month` `day-of-year` `week-of-year` `week-of-year-iso` `month-of-year` `quarter-of-year` `year-of-era` `second-of-minute`.
- `binning`: `{strategy: num-bins, num-bins: <int>}`, `{strategy: bin-width, bin-width: <number>}`, or `{strategy: default}`.
