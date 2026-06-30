---
name: transform-test
description: Test a transform — or a card (saved question / model) — against fixture CSVs via `mb transform-test` — seeds scratch tables, runs the target, and checks its output against an expected CSV and/or SQL assertions, never touching real tables. Covers the inputs→fixtures→run loop, the exact-header CSV contract, `--target-type transform|card`, the pass/fail diff, SQL assertions (`--assert` .sql files/globs), YAML suites (`--suite`), chained sub-graph tests (`--source`), and `--ignore-columns`. Load when validating a transform's or card's logic — "test this transform", "test this question against sample data", "assert no negative revenue", "does my transform produce the right output", or anything `mb transform-test …`.
allowed-tools: Read, Write, Edit, Bash
---

# Testing transforms

`mb transform-test` runs a **target** — a transform, or a card (saved question / model) — against **fixture CSVs you supply** instead of the real source tables, then checks its output against an **expected CSV** and/or **SQL assertions**. It seeds throwaway scratch tables, runs the target's query over them, compares, and drops everything — **real tables are never read or written.** Use it to validate a transform's or card's logic on small, known data before trusting it on production rows.

You check the output two ways, and can combine them: an **expected CSV** (`--expected`, exact-output multiset diff) and/or **assertions** (`--assert`, SQL queries that must return zero rows). At least one of `--expected` or `--assert`/`--suite` is required — `--expected` is **not** mandatory on its own anymore.

Authoring and running transforms for real is the `transform` skill (`mb skills get transform`); deciding what to build is `data-transformation` (`mb skills get data-transformation`). Flag/profile/output conventions are in `core` (`mb skills get core`).

## The loop: inputs → fixtures → run

1. **Discover** which tables need fixtures and their exact columns (`transform-test inputs`).
2. **Write** one CSV per input table, plus an expected-output CSV and/or `.sql` assertion files.
3. **Run** the test; read passed / FAILED + the diff and/or per-assertion results (`transform-test run`).

The positional argument is the **target** id whose output is diffed. By default that's a transform; pass `--target-type card` to target a saved question or model instead (see "Card targets" below). Everything else — inputs, fixtures, `--source`, the diff — works the same either way.

## 1. Discover required inputs

```bash
mb transform-test inputs <target-id> --profile <name> --json
```

Returns one row per input table you must supply a fixture for. Each carries:

- `table_id` — use it as the key in `--input <table-id>=<file>`.
- `name` / `schema` — the real table (for your reference; the fixture replaces it).
- `columns` — the **exact** column-name list your CSV header must contain.

Omit `--source` to test the target transform on its own (its direct input tables). With `--source` it lists the **leaf** tables of the sub-graph (see "Chained tests" below).

## 2. Write the fixture CSVs — the header contract

Each input CSV's header must contain **exactly the column names `inputs` reported** — all of them, **case-sensitive**, no extras. Column **order doesn't matter** (matched by name); a missing or unexpected column fails the run with a header-mismatch error. Values are parsed against each column's real warehouse type (integers, dates, etc.), so write values that parse — `2024-01-01` for a date column, an integer for an int column. Leave a cell empty for `NULL`.

```bash
mkdir -p ./.scratch
cat > ./.scratch/bird_count.csv <<'CSV'
id,date,count
1,2024-01-01,2
2,2024-01-02,5
3,2024-01-03,3
CSV

# The expected output: header = the columns your transform SELECTs, rows = what it should produce.
cat > ./.scratch/expected.csv <<'CSV'
id,date,count
1,2024-01-01,2
3,2024-01-03,3
CSV
```

The expected CSV's columns are matched against the transform's **actual output** columns; the comparison is a multiset (row order is ignored, duplicates count).

## 3. Run the test

```bash
mb transform-test run <target-id> \
  --input <table-id>=./.scratch/bird_count.csv \
  --expected ./.scratch/expected.csv \
  --profile <name> --json
```

- `--input` is comma-separated `<table-id>=<csv-path>` pairs, **one per table `inputs` listed** (e.g. `--input 229=orders.csv,223=people.csv`). The table id is the `table_id` from step 1.
- `--expected` is the path to the expected-output CSV. **Optional** — provide it, `--assert`/`--suite`, or both, but at least one.
- Exits **0 on pass, non-zero on fail** (good for scripting / CI gates).

Reading the result:

- The plain (text) summary says `Transform <id> test run passed.` or `Transform <id> test run FAILED …`, followed — whenever assertions ran — by a one-line breakdown (`N assertions — A passed, B FAILED, C warn …`) and a per-assertion table (name / status / failing rows).
- `--json` returns `{status, diff, assertions, test_run_id}`. `status` is `passed` or `failed` (the only two values). `diff` is the expected-CSV comparison (`null` when you ran assertions-only). `assertions` is `null` when none ran, else an array of `{name, status: passed|failed|warn, failing_row_count, sample_rows, columns}`. On `failed`, the `diff` reports missing/extra rows and cell mismatches, and each failing assertion carries its `failing_row_count` + a capped `sample_rows`. Always re-run with `--json` (or start with it) to see why a test failed.
- **Output format follows the usual `core` rules:** `auto` (the default) prints the human summary + table in a terminal but **emits JSON when stdout is piped/redirected** (CI, `| cat`, `$(…)`). Pass `--format text` to force the human table when piping, or `--json` to force JSON in a terminal.
- A run that couldn't complete — bad CSV header, an unsupported transform, etc. — isn't a `failed` status; it surfaces as a thrown error envelope on a non-zero exit, distinct from a clean `failed` diff.

## Assertions (`--assert`)

An **assertion** is a SQL query that **passes iff it returns zero rows.** Write each one to a
`.sql` file; `--assert` points at the file (or a glob of them). Inside the SQL, reference the
synthetic relation **`test_output`** (the target's output) and/or the input table names — the
harness redirects every real table to scratch and binds `test_output` to the target.

```bash
cat > ./.scratch/no_negative_revenue.sql <<'SQL'
SELECT * FROM test_output WHERE revenue < 0
SQL

mb transform-test run 173 --source 172 \
  --input 229=orders.csv \
  --assert ./.scratch/no_negative_revenue.sql \
  --profile <name>
```

- **`--assert` accepts only `.sql` file paths or globs — inline SQL is NOT supported.** A
  non-`.sql` value is rejected with a clear error; write the query to a file instead.
- The **assertion name** is the file basename without `.sql` (`no_negative_revenue` above).
- **Repeatable, and comma-separated.** All of these accumulate:
  `--assert a.sql --assert b.sql`, `--assert a.sql,b.sql`, `--assert 'checks/*.sql'` (a glob
  expands to one assertion per matching `.sql` file; a glob matching nothing is an error).
- **Severity:** `--assert` files default to **error** severity (a failure fails the run, non-zero
  exit). To mark an assertion as a **warn** (reported, but does not fail the run or flip the exit
  code), declare it in a `--suite` with `severity: warn`.
- `--assert` and `--expected` compose: provide either or both. With assertions only, the response
  `diff` is `null` and the result is driven entirely by the assertions.

## Test suites (`--suite`)

A **suite** is a YAML file that declares a whole run — target, sources, inputs, expected,
ignore-columns, and assertions (with optional per-assertion `severity`). It is parsed **entirely
client-side**; the server sees the same request as the equivalent flags.

```yaml
# suites/orders.yaml
target:
  type: transform # or: card
  id: 173
sources: [172]
inputs:
  - table: 229
    file: ./.scratch/orders.csv
expected: ./.scratch/expected.csv # optional
ignore_columns: [snapshot_ts]
assertions:
  - name: no_negative_revenue
    sql: SELECT * FROM test_output WHERE revenue < 0 # inline sql IS allowed in a suite
    severity: error
  - name: every_state_present
    file: ./.scratch/every_state_present.sql # …or point at a .sql file
    severity: warn
```

```bash
mb transform-test run --suite suites/orders.yaml --profile <name>
```

- A suite assertion sets **exactly one** of `sql:` (inline) or `file:` (path to a `.sql` file).
  (Inline SQL is fine _here_ — the suite is itself a file you author; only the `--assert` flag is
  file-only.)
- **Ad-hoc flags compose with a suite:** `--source`/`--input`/`--expected`/`--ignore-columns`
  **override** the suite's values; `--assert` assertions **append** to the suite's. The positional
  target id (and `--target-type`) may be omitted when the suite declares `target`.

## Chained / sub-graph tests (`--source`)

To test a transform that depends on **other transforms'** outputs, pick boundary `--source` transform ids. Every node on a path from a source to the target runs in dependency order, fed by fixtures only at the **leaves** (raw tables + any sibling outputs not produced inside the selection). `transform-test inputs <target> --source <ids>` tells you exactly which leaves to supply.

```bash
mb transform-test inputs 173 --source 172 --profile <name> --json     # lists the leaf tables
mb transform-test run 173 --source 172 \
  --input 229=orders.csv,223=people.csv \
  --expected expected.csv --profile <name> --json
```

`--source` is comma-separated ids. Omitting it == testing the target alone. All transforms in the sub-graph must share one database (a cross-database selection is rejected).

## Card targets (`--target-type card`)

The target can be a **card** — a saved question or model — instead of a transform. The card's query is what gets diffed: its producing transforms run in scratch (seeded from your fixtures), the card's query runs over those scratch outputs, and the result is compared to the expected CSV. The inputs → fixtures → run loop is identical; only the positional id and `--target-type` change.

```bash
mb transform-test inputs <card-id> --target-type card --source <ids> --profile <name> --json
mb transform-test run    <card-id> --target-type card --source <ids> \
  --input 229=orders.csv,223=people.csv --expected expected.csv --profile <name> --json
```

- The positional is a **card id** (question or model). `--target-type` defaults to `transform`, so transform targets need no flag.
- **Precondition:** the transform output(s) the card reads must be **materialized and synced** — run the producing transform with `mb transform run <id> --sync` first. A card built on an un-materialized output can't be linked to its producer, and you'll get a `sources-not-ancestors` error.
- Native and MBQL cards both work. Native cards carry the same bare-table-qualifier limitation as native transforms (below).

## Ignoring non-deterministic columns

For output columns you can't pin in an expected CSV — `now()` timestamps, snapshot dates, random ids — exclude them from the diff:

```bash
mb transform-test run 42 --input 229=orders.csv --expected out.csv \
  --ignore-columns snapshot_ts,run_id --profile <name> --json
```

`--ignore-columns` is comma-separated **output** column names. Naming a column that isn't in the output is an error, so check the transform's SELECT first.

## Limitations & gotchas

- **Native SQL (in a transform or a native card) that qualifies columns by the bare table name can't be test-run.** `SELECT orders.id FROM orders` fails with a typed 422 (the fixture-redirect rewrites the table reference but can't safely follow a `orders.`-qualified column). **Alias the table** — `SELECT o.id FROM orders o` — or use unqualified column names. It always fails _safely_ (you get an error, never a wrong-but-green result), and MBQL targets aren't affected.
- **Header must match the real table exactly.** Don't guess columns — copy them from `transform-test inputs`. All columns are required; the test isn't a projection.
- **Provisional / unreleased.** These commands target a dev build of the transforms feature; if `mb transform-test` reports the endpoint is unavailable, the connected instance predates it.
- **Scratch only.** Fixtures seed prefix-guarded scratch tables that are dropped in a `finally` (success, failure, or error). A test run creates no transform-run record and never writes the transform's real output table.

## Don't

- Don't hand-guess the input `table_id`s or column headers — always run `transform-test inputs` first; the ids and exact columns come from there.
- Don't treat a `failed` status as a tool error — it's a real result (output ≠ expected, or an error-severity assertion returned rows). Read the `--json` `diff` and `assertions` to fix the transform, the expected CSV, or the assertion.
- Don't supply fixtures for tables `inputs` didn't list, or omit ones it did — the `--input` set must match the required set exactly.
- Don't pass inline SQL to `--assert` — it only accepts `.sql` file paths or globs. Write the query to a file (or put it in a `--suite` under `sql:`).
