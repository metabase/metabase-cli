---
name: transform
description: Author Metabase transforms as files and run them on the instance, covering the file shape (native SQL or MBQL source, target table, collection, tags), import then run with wait, run inspection and cancel, iterating on a failing transform in place, transform tests, and tags and jobs as files. Load when the user touches transforms, as in "build a transform", "run a transform", "fix a failing transform", "test this transform", "schedule these transforms", or anything `mb transform …`, `mb transform-test …`, `mb transform-job …`.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
requires: [transforms]
---

# Transforms

A **transform** persists the result of a query (native SQL or MBQL) to a warehouse table that cards, dashboards and other transforms read. It runs on a schedule through a transform job, or on demand with `mb transform run`. A transform is a file under `collections/transforms/` (`mb skills get metabase-representation-format`, "Transform" in `spec.md`); the loop that puts it on the instance is in `core`. Deciding which transforms to build, modeling a raw database into clean tables, is the `rde` skill's build-clean-tables playbook.

## The file

```yaml
name: user_counts_by_signup_year
description: One row per signup year (key signup_year). Counts users by the year they signed up.
entity_id: <mb entity-id>
creator_id: <email>
source_database_id: Sample Database
collection_id: <transforms-namespace collection entity_id, or null>
source:
  type: query
  query:
    "lib/type": mbql/query
    database: Sample Database
    stages:
      - "lib/type": mbql.stage/native
        native: |-
          SELECT
            date_trunc('year', u.created_at)::date AS signup_year,
            count(*)::int                          AS user_count
          FROM public.users u
          GROUP BY 1
          ORDER BY 1
target:
  type: table
  database: Sample Database
  schema: public
  name: user_counts_by_signup_year
serdes/meta:
  - id: <the same entity_id>
    label: user_counts_by_signup_year
    model: Transform
```

- **Keep the SQL formatted** in a `|-` block scalar; it is what the reviewer and the Metabase editor show.
- A **structured** source is an `mbql.stage/mbql` stage in the file form (`mbql`). Name aggregation outputs: a bare `count` or `avg_2` becomes the warehouse column name.
- Alias every source table and qualify columns by the alias (`FROM public.users u … u.created_at`); transform tests need it.
- **`collection_id` must be a collection in the `transforms` namespace**: a collection file under `collections/transforms/` with `namespace: transforms`. An ordinary collection is refused on import. `null` leaves the transform uncollected. The cards and dashboards built on the output table go in ordinary collections.
- `target.schema` is the schema the table is written into. `target.type: table` rebuilds the table on every run; `table-incremental` with a `source-incremental-strategy` appends or merges. The format leaves the strategy's shape open, so copy it from an incremental transform on the instance (`mb transform get <id> --full --json`).

<!-- requires: pythonLibrary -->

A Python source is `source.type: python` with `body` and `source-tables` (`spec.md`, "Python Source"); shared modules are files under `python_libraries/`.

<!-- /requires -->

## Import, then run

After `mb validate`, commit, push and `mb git-sync import --branch <branch>`:

```bash
EID=<entity_id>
ID=$(mb eid --model transform "$EID" --json | jq -r --arg e "$EID" '.entity_ids[$e].id')
mb transform run "$ID" --sync --json | jq '{status: .final.status, table: .target_table_id, msg: .final.message}'
```

An entity id the instance does not hold comes back with a `status` other than `ok` and no `id`: the import did not bring that file in.

- `--wait` polls until `succeeded` or `failed`. Without it you get only `{message, run_id, final: null}`; never poll bare `run` in a loop.
- `--sync` implies `--wait`, then waits until the run registers its output table and adds `target_table_id` (a number, or `null` if it had not registered before the timeout; re-poll `mb transform get <id> --json` until it is a number). Use it before building MBQL on the output: MBQL addresses tables by id, native SQL reads `<schema>.<name>` at once.
- On a failed run (`final.status` in `failed`, `timeout`, `canceled`) the CLI exits 1 and writes `transform run <id> failed` to stderr; the detail is only in `final.message` on stdout.

## Inspect runs and cancel

```bash
mb transform list --json
mb transform get <id> --full --json          # includes the last run
mb transform dependencies <id> --json        # upstream transforms this one runs after
mb transform runs --transform-id <id> --limit 10 --json
mb transform get-run <run-id> --json         # a RUN id, from run or runs
mb transform cancel <id> --json              # the TRANSFORM id; 404 when nothing is running
```

Cancel on a native SQL transform marks the run `canceling` but does not kill the warehouse query; it lands `canceled` after the query finishes (or stays `succeeded` if the write had committed). A Python transform's worker is interrupted directly.

## Iterating on a failing transform

Edit the file in place and import again. The `entity_id` keeps the same transform, the same materialized table and the same file, so the branch history shows one transform and its fix, and nothing downstream loses its reference. Never replace a transform with a new file and a new `entity_id` to retry.

Columns and types come from the result set. A changed SELECT shape can fail the next run on a column mismatch; no command drops a transform's table, so ask the user to drop it in Metabase, or give `target.name` a new name and have the old table dropped. A changed shape also needs a run with `--sync` before MBQL sees the new columns.

<!-- requires: transformTests -->

## Transform tests

A test runs the transform against fixture inputs instead of its real sources and checks expectations on the output; nothing real is read or written and the transform need not have run. Tests have no file form, so they are written through the CLI against the transform's numeric id:

```bash
mb transform-test create --file ./.scratch/<m>.test.json | jq '{id, name}'
mb transform-test run <test-id> --json | jq '{status, failed: [.expectations[] | select(.status != "passed")]}'
mb transform-test update <test-id> --file ./.scratch/<m>.test.patch.json   # omitted fields keep their value
mb transform-test list --transform-id <id> --fields id,name
mb transform-test delete <test-id>
```

The body is `{transform_id, name, description, inputs, expectations}`: one input per table the SQL reads, as `format: rows` (columns with warehouse types, and rows) or `format: sql`; expectations `equals` (a multiset of rows over named columns) or `empty` (a query that must return nothing). The server checks inputs and expectations against the transform before saving; a refusal is an HTTP error whose code starts with `transform-test.`. A failed `equals` reports `missing-rows`, `extra-rows`, `cell-mismatches`; a failed `empty` a `sample`. Keep each test body in `./.scratch/<m>.test.json` so the next change edits the same file. What to test and the fixture rules are in the `rde` skill, `references/transform-tests.md`.

<!-- /requires -->

## Tags and jobs

Tags and jobs are files too: a tag under `transforms/transform_tags/`, a job under `transforms/transform_jobs/` with a Quartz `schedule` and `job_tags` naming tags by `entity_id`. A transform joins a job by carrying one of its tags in its own `tags` list (`spec.md`, "Transform Tags"); the job never lists transforms. The built-in `hourly`, `daily`, `weekly` and `monthly` tags already exist on the instance and in an exported repository; reuse their `entity_id`s.

```bash
mb transform-tag list --json
mb transform-job list --json
mb transform-job transforms <id> --json      # which transforms the job resolves to, by tag
mb transform-job run <id> --json             # run the job now
mb transform-job run <id> --force-refresh    # also re-run dependencies that are already fresh
```

`transform-job run` returns `{message, started, run_id}` at once, with no `--wait`; follow it with `mb transform runs` until none is `started`. A job row's `active` is `null` on a server that cannot switch jobs off.

## Don't

- Don't put a transform in an ordinary collection.
- Don't retry a failing transform as a new file; edit the one you have.
- Don't loosen a test expectation to make it pass; fix the SQL, or the fixture when the fixture was wrong, and say which.
