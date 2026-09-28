# MBQL operator reference

Every clause is `[op, {options}, ...args]` with `{}` when there are no options. `<field>` is `["field", {}, <field id>]`, or any expression of the right type; `<pred>` is a filter clause. Clause heads are lowercase and hyphenated, exactly as written here.

## Filters

A stage's `filters` are ANDed.

- `["and", {}, <pred>, <pred>, …]` / `["or", …]`: two or more
- `["not", {}, <pred>]`
- `["=", {}, <field>, <v1>, <v2>, …]` / `["!=", …]`: several values mean any of them / none of them
- `["in", {}, <field>, <v1>, <v2>, …]` / `["not-in", …]`: multi-value membership
- `["<", {}, <a>, <b>]` / `["<=", …]` / `[">", …]` / `[">=", …]`
- `["between", {}, <field>, <min>, <max>]`: inclusive; dates as `"2024-01-01"`
- `["inside", {}, <lat>, <lon>, <lat-max>, <lon-min>, <lat-min>, <lon-max>]`: bounding box
- `["is-null", {}, <field>]` / `["not-null", …]`
- `["is-empty", {}, <field>]` / `["not-empty", …]`: NULL or `""`
- `["contains", {}, <field>, "a", "b", …]` / `["does-not-contain", …]` / `["starts-with", …]` / `["ends-with", …]`: any of the strings (`does-not-contain`: none of them); `{"case-sensitive": false}` in options
- `["time-interval", {}, <field>, <n>, "<unit>"]`: the `n` whole units before the current one (`n` negative) or after it, or `"current"` / `"last"` / `"next"` for a single unit; `{"include-current": true}` in options adds the current unit
- `["relative-time-interval", {}, <field>, <n>, "<unit>", <offset n>, "<offset unit>"]`: a window shifted from now: last 3 months, a year ago
- `["during", {}, <field>, "2024-03-15", "<unit>"]`: the whole unit containing the date
- `["segment", {}, <segment id>]`: a saved segment, on its table

Units for `time-interval` and friends: `millisecond`, `second`, `minute`, `hour`, `day`, `week`, `month`, `quarter`, `year`.

## Aggregations

- `["count", {}]` / `["count", {}, <field>]`: rows / non-NULL values
- `["sum", {}, <field>]` / `["avg", …]` / `["median", …]` / `["stddev", …]` / `["var", …]`: numeric
- `["min", {}, <field>]` / `["max", …]`: any orderable
- `["distinct", {}, <field>]`: count of distinct values
- `["percentile", {}, <field>, 0.9]`: 0 to 1
- `["count-where", {}, <pred>]`
- `["sum-where", {}, <field>, <pred>]`
- `["distinct-where", {}, <field>, <pred>]`
- `["share", {}, <pred>]`: fraction of rows, 0 to 1
- `["cum-count", {}]` / `["cum-sum", {}, <field>]`: running totals over the breakout
- `["offset", {}, <aggregation>, <n>]`: the value n breakout rows back (negative) or ahead; in `aggregation` only
- `["metric", {}, <card id>]`: a saved metric, on its table

<!-- requires: measures -->

`["measure", {}, <measure id>]` is a saved measure, on its table.

<!-- /requires -->

Name the output in options: `["sum", {"name": "revenue", "display-name": "Revenue"}, <field>]`.

## Expressions

Named in `expressions` by `{"lib/expression-name": "<name>"}` in the options, or used inline anywhere a value goes.

**Math:** `["+", {}, a, b, …]`, `["-", …]`, `["*", …]`, `["/", …]` (always a float), `["abs", {}, x]`, `["ceil", …]`, `["floor", …]`, `["round", …]`, `["sqrt", …]`, `["exp", …]`, `["log", …]`, `["power", {}, base, exponent]`. `round` takes one argument and rounds to an integer.

**Conversion:** `["integer", {}, <text or number>]`, `["float", {}, <text>]`, `["text", {}, <any>]`, `["date", {}, <text or datetime>]`, `["datetime", {}, <ISO text>]`, `["datetime", {"mode": "simple"}, <text>]`, `["datetime", {"mode": "unix-seconds"}, <number>]` (number modes `unix-seconds`, `unix-milliseconds`, `unix-microseconds`, `unix-nanoseconds`).

**Text:** `["concat", {}, a, b, …]`, `["substring", {}, s, <start from 1>, <length>?]`, `["replace", {}, s, "find", "replacement"]`, `["regex-match-first", {}, s, "<regex>"]`, `["split-part", {}, s, "<delimiter>", <position from 1>]`, `["length", {}, s]`, `["trim", …]`, `["ltrim", …]`, `["rtrim", …]`, `["upper", …]`, `["lower", …]`, `["host", {}, <url>]`, `["domain", …]`, `["subdomain", …]`, `["path", …]`.

**Conditional:** `["case", {}, [[<pred>, <value>], [<pred>, <value>]], <default>?]` (alias `if`), `["coalesce", {}, a, b, …]`.

```json
[
  "case",
  { "lib/expression-name": "Tier" },
  [
    [[">", {}, ["field", {}, 14], 100], "Premium"],
    [["<=", {}, ["field", {}, 14], 20], "Budget"]
  ],
  "Standard"
]
```

**Dates:**

- `["now", {}]` / `["today", {}]`
- `["datetime-add", {}, <date>, <n>, "<unit>"]` / `["datetime-subtract", …]`: `n` an integer
- `["datetime-diff", {}, <from>, <to>, "<unit>"]`: units `second` … `year`; the way to subtract two dates
- `["interval", {}, <n>, "<unit>"]`: added to a date with `+`
- `["get-year", {}, <date>]` / `get-quarter` / `get-month` / `get-day` / `get-hour` / `get-minute` / `get-second`: an integer; a quarter is `1`–`4`
- `["get-week", {}, <date>]` / `["get-day-of-week", {}, <date>]`: a fourth argument `"iso"`, `"us"` or `"instance"` sets the week convention
- `["temporal-extract", {}, <date>, "<extract unit>"]`: `year-of-era`, `quarter-of-year`, `month-of-year`, `week-of-year-iso`, `week-of-year-us`, `week-of-year-instance`, `day-of-month`, `day-of-week`, `day-of-week-iso`, `hour-of-day`, `minute-of-hour`, `second-of-minute`
- `["month-name", {}, <1–12>]` / `["quarter-name", {}, <1–4>]` / `["day-name", {}, <1–7>]`
- `["convert-timezone", {}, <date>, "America/New_York", "<from tz>"?]`
- `["relative-datetime", {}, <n>, "<unit>"]` / `["relative-datetime", {}, "current"]`: a point relative to now, for comparisons
- `["absolute-datetime", {}, "2024-03-15T00:00:00", "<unit>"]`: the unit is required, `"default"` keeps the literal; a date literal (`"2024-03-15"`) takes a date unit (`day` … `year`) or `"default"`

Add, subtract, diff and interval units: `millisecond` (not diff), `second`, `minute`, `hour`, `day`, `week`, `month`, `quarter`, `year`.

## Field option: `temporal-unit`

On a date field ref, mostly in `breakout`:

- Truncation: `minute`, `hour`, `day`, `week`, `month`, `quarter`, `year` (and `millisecond`, `second`).
- Extraction, an integer: `minute-of-hour`, `hour-of-day`, `day-of-week`, `day-of-month`, `day-of-year`, `week-of-year`, `month-of-year`, `quarter-of-year`, `year-of-era`, `second-of-minute`.
- `default` lets Metabase pick.

## Field option: `binning`

On a numeric or coordinate field ref in `breakout`:

- `{"strategy": "num-bins", "num-bins": 10}`: equal-width bins.
- `{"strategy": "bin-width", "bin-width": 5}`: a fixed width.
- `{"strategy": "default"}`: Metabase picks.

## References

- field: `["field", {…}, <field id>]`, or `["field", {"base-type": "type/…"}, "<column name>"]` for a previous stage's or a source card's column
- expression: `["expression", {}, "<expression name>"]`, same stage
- aggregation: `["aggregation", {}, "<lib/uuid>"]`, the `lib/uuid` (from `mb uuid`) set in the options of an aggregation of the same stage
