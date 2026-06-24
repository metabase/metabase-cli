---
name: transform-test
description: Test a transform (or a connected sub-graph of transforms) against fixture CSVs via `mb transform-test` — seeds scratch tables, runs the transform, and diffs its output against an expected CSV, never touching real tables. Covers the inputs→fixtures→run loop, the exact-header CSV contract, reading the pass/fail diff, chained sub-graph tests (`--source`), `--ignore-columns`, and the native-SQL limitations. Load when the user wants to validate a transform's logic before running it for real — "test this transform", "check the transform against sample data", "does my transform produce the right output", "write fixtures for a transform", or anything `mb transform-test …`.
allowed-tools: Read, Write, Edit, Bash
---

# Testing transforms

`mb transform-test` runs a transform against **fixture CSVs you supply** instead of the real source tables, then diffs the output against an **expected CSV**. It seeds throwaway scratch tables, runs the transform's query into a scratch output, compares, and drops everything — **real tables are never read or written.** Use it to validate a transform's logic on small, known data before trusting it on production rows.

Authoring and running transforms for real is the `transform` skill (`mb skills get transform`); deciding what to build is `data-transformation` (`mb skills get data-transformation`). Flag/profile/output conventions are in `core` (`mb skills get core`).

## The loop: inputs → fixtures → run

1. **Discover** which tables need fixtures and their exact columns (`transform-test inputs`).
2. **Write** one CSV per input table + one expected-output CSV.
3. **Run** the test; read passed / FAILED + the diff (`transform-test run`).

The positional argument is always the **target** transform id (the one whose output is diffed).

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
- `--expected` is the path to the expected-output CSV (required).
- Exits **0 on pass, non-zero on fail** (good for scripting / CI gates).

Reading the result:

- The plain summary says `Transform <id> test run passed.` or `Transform <id> test run FAILED — output did not match expected. Re-run with --json to see the diff.`
- `--json` returns `{status, diff, test_run_id}` where `status` is `passed` or `failed` (those are the only two values). On `failed`, **`diff` is where the truth is** — it reports missing rows (expected but not produced), extra rows (produced but not expected), and cell-level mismatches. Always re-run with `--json` (or start with it) to see why a test failed.
- A run that couldn't complete — bad CSV header, an unsupported transform, etc. — isn't a `failed` status; it surfaces as a thrown error envelope on a non-zero exit, distinct from a clean `failed` diff.

## Chained / sub-graph tests (`--source`)

To test a transform that depends on **other transforms'** outputs, pick boundary `--source` transform ids. Every node on a path from a source to the target runs in dependency order, fed by fixtures only at the **leaves** (raw tables + any sibling outputs not produced inside the selection). `transform-test inputs <target> --source <ids>` tells you exactly which leaves to supply.

```bash
mb transform-test inputs 173 --source 172 --profile <name> --json     # lists the leaf tables
mb transform-test run 173 --source 172 \
  --input 229=orders.csv,223=people.csv \
  --expected expected.csv --profile <name> --json
```

`--source` is comma-separated ids. Omitting it == testing the target alone. All transforms in the sub-graph must share one database (a cross-database selection is rejected).

## Ignoring non-deterministic columns

For output columns you can't pin in an expected CSV — `now()` timestamps, snapshot dates, random ids — exclude them from the diff:

```bash
mb transform-test run 42 --input 229=orders.csv --expected out.csv \
  --ignore-columns snapshot_ts,run_id --profile <name> --json
```

`--ignore-columns` is comma-separated **output** column names. Naming a column that isn't in the output is an error, so check the transform's SELECT first.

## Limitations & gotchas

- **Native SQL that qualifies columns by the bare table name can't be test-run.** `SELECT orders.id FROM orders` fails with a typed 422 (the fixture-redirect rewrites the table reference but can't safely follow a `orders.`-qualified column). **Alias the table** — `SELECT o.id FROM orders o` — or use unqualified column names. It always fails *safely* (you get an error, never a wrong-but-green result), and MBQL transforms aren't affected. This is a known, accepted limitation.
- **Header must match the real table exactly.** Don't guess columns — copy them from `transform-test inputs`. All columns are required; the test isn't a projection.
- **Provisional / unreleased.** These commands target a dev build of the transforms feature; if `mb transform-test` reports the endpoint is unavailable, the connected instance predates it.
- **Scratch only.** Fixtures seed prefix-guarded scratch tables that are dropped in a `finally` (success, failure, or error). A test run creates no transform-run record and never writes the transform's real output table.

## Don't

- Don't hand-guess the input `table_id`s or column headers — always run `transform-test inputs` first; the ids and exact columns come from there.
- Don't treat a `failed` status as a tool error — it's a real result (output ≠ expected). Read the `--json` `diff` to fix either the transform or the expected CSV.
- Don't supply fixtures for tables `inputs` didn't list, or omit ones it did — the `--input` set must match the required set exactly.
