---
name: transform
description: Author and run Metabase transforms — source/target grammar (native SQL, structured MBQL, Python), create + run-with-wait, run inspection, the dependency graph, cancel semantics, the update-vs-recreate iteration rule, the materialized-table lifecycle, plus transform tags and the tag-driven job schedules. Load when the user touches transforms — "create a transform", "run a transform", "fix a failing transform", "list transform runs", "cancel a running transform", "tag a transform", "schedule a transform job".
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

# Transforms

A **transform** persists the result of a query (native SQL, MBQL, or Python) to a warehouse table the user can read from cards, dashboards, and other transforms. It runs on a schedule (a job, `transform_job_write`) or on demand (`transform_run`).

Working-file conventions live in the `core` skill. Deciding _which_ transforms to build — modeling a whole raw database into clean, analysis-ready tables — is the `data-workflow` skill's build-clean-tables stage.

## Body shape

A transform has two halves, and `transform_write` takes them as `source` and `target`:

- `source` — what it reads and computes. A query source is `{"type": "query", "query": <MBQL 5 query>}`, where the query holds either a native stage or MBQL stages. A Python source is `{"type": "python", "body": "<python>", "source-tables": [{"alias": "orders", "database_id": 1, "schema": "public", "table": "orders"}]}`.
- `target` — the warehouse destination. Full refresh: `{"type": "table", "database": <db-id>, "schema": "public", "name": "orders_daily"}` — every run drops and rewrites the table. Incremental: `{"type": "table-incremental", "database": <db-id>, "schema": "public", "name": "orders_daily", "target-incremental-strategy": {"type": "append"}}`, or `{"type": "merge", "unique-key": [{"name": "id"}]}` as the strategy when rows are updated in place.

Native SQL is the simplest source, and `transform_write`'s `native` parameter is sugar for it: `native: {database_id: 1, sql: "SELECT …"}` assembles the same query source, whose stage is `{"lib/type": "mbql.stage/native", native: "<sql>"}` inside a `{"lib/type": "mbql/query", database: <db-id>, stages: [...]}` wrapper. Pass the whole `source` object yourself when you need the raw form, or point `source_file` at a JSON file holding it — that keeps a Python body or a long query on disk instead of in the conversation.

**A transform's SQL takes no template tags.** It runs unattended, with nothing to fill a `{{tag}}` in — parameterize by writing the value into the SQL, or by filtering downstream in the questions that read the output table.

For a **structured** MBQL source (an `mbql.stage/mbql` stage) — the options-object-is-always-second clause rule, the never-write-a-`lib/uuid` rule, sorting an aggregate in a later stage, and naming aggregation output columns — read the `mbql` skill. For a transform target, naming aggregation output columns matters more than usual: a bare `count` / `avg_2` becomes the warehouse column name.

Read an existing transform's body back with `get_content`: `{items: [{type: "transform", id: 7}], include: ["definition"]}` returns its `source`. `response_format: "detailed"` returns the full row (`target_table_id`, `last_run`, `entity_id`, `tag_ids`, …) instead of the compact projection.

## Create + run (native SQL)

**Keep the SQL formatted.** Author it multi-line in a file (`./.scratch/user_counts_by_signup_year.sql`), iterate on it with `execute_sql`'s `sql_file`, then hand `transform_write` the same path as `native.sql_file` — the stored SQL is byte-identical to the SQL you validated. The stored text is what the Metabase editor renders, so a single-line blob is valid but unreadable when anyone opens the transform.

```sql
SELECT
  date_trunc('year', created_at)::date AS signup_year,
  COUNT(*)::int                        AS user_count
FROM public.users
GROUP BY 1
ORDER BY 1
```

```
transform_write {
  method: "create",
  name: "user_counts_by_signup_year",
  description: "Counts users by year of signup",
  native: { database_id: 1, sql_file: "./.scratch/user_counts_by_signup_year.sql" },
  target: { type: "table", database: 1, schema: "public", name: "user_counts_by_signup_year" }
}

transform_run { action: "run", id: 7 }
```

- The database id comes from `browse_data` `{action: "list_databases"}`; ids are per-instance. Target `schema` is the schema the result table is written into (e.g. `public`).
- `create` returns the compact projection: `{id, name, description, source_type, target: {type, database, schema, name}, target_db_id}`. Read `target.schema` / `target.name` straight off it — no follow-up read. Nothing has run yet; `transform_run` is what materializes the table.
- If a transform with the same `name` already has a YAML representation on disk under the configured remote-sync repo, `create` mints a `_2` suffix on the exported filename (the new transform gets a fresh `entity_id`; the prior one isn't touched). For "iterate on the same concept", update the transform you have — see "Iterating on a failing transform".
- **`collection_id` only accepts a collection in the `:transforms` namespace.** Transforms aren't filed next to cards and dashboards — a normal analytics collection id fails create/update with `collection_id: A Transform can only go in Collections in the :transforms namespace.` Omit `collection_id` and the transform is uncollected, which is the common case. Cards and dashboards you build **on top of** the output table go in ordinary collections — so "put the transform and its dashboard in collection X" means _X holds the dashboard + cards; the transform itself stays out of it._

## Running: what `wait` and `sync` actually do

`transform_run` `{action: "run", id}` **waits and syncs by default**, and returns `{run_id, status, message, target_table_id}`.

- **`wait`** (default `true`) blocks until the run reaches a terminal status — `succeeded`, `failed`, `timeout`, `canceled` — and returns that status.
- **`sync`** (default `true`) does everything `wait` does, then keeps polling until the run's output table is **registered in Metabase** and adds `target_table_id` — the numeric table id you build MBQL against. The run registers the table itself; nothing else has to be triggered. **`sync` implies `wait`**: `wait: false` only takes effect if you also pass `sync: false`, and `{action: "run", id, wait: false, sync: false}` is the fire-and-forget form, returning `{run_id, transform_id, message}` with the outcome unknown and nothing re-checking it for you.
- A **failed run comes back as an error** carrying Metabase's own message. That message is the answer — the SQL is wrong, the target column shape moved, the warehouse rejected the write. Fix the source with `transform_write` `{method: "update", …}` and run again; re-running the same body fails the same way.
- **`timeout_ms`** (default 300000) caps how long the call blocks. On expiry the run keeps going server-side and the tool says so, naming `{action: "get_run", id: <run-id>}` as the way to pick the thread back up. Raise `timeout_ms` for a genuinely long transform rather than looping `run` yourself.
- If the run succeeds but the table hasn't registered before the timeout, `target_table_id` comes back `null` — the run is still a success. Re-run with `sync: true`, or find the table with `browse_data`.

## Inspect

```
search        { type: ["transform"] }                                   # every transform
search        { query: "orders", type: ["transform"] }                  # by keyword
get_content   { items: [{type: "transform", id: 7}], include: ["definition"] }
transform_run { action: "dependencies", id: 7 }                         # upstream transforms this one must run after
```

`dependencies` returns the transforms that must run before this one — the graph a job walks when it schedules work.

After a run the table physically exists in the warehouse, but Metabase addresses tables and columns by numeric id, so **MBQL and the UI can't reference a brand-new table until it registers** (native SQL — an `execute_sql` call or a native card against `<schema>.<name>` — reads it immediately). The default `sync` on `run` is what hands you the id:

```
transform_run { action: "run", id: 7 }              # → target_table_id: 42
browse_data   { action: "get_fields", table_ids: [42] }   # field ids for MBQL
```

Columns and types are inferred from the result set. **Change the SELECT shape and the next run fails on a column mismatch** against the existing table. Either point `target.name` at a fresh table name, or delete the transform with `delete_target_table: true` and create it again — the second costs you the `entity_id`. A changed shape also needs a re-run before MBQL sees the new or renamed columns.

## Inspect runs and cancel an in-flight run

```
transform_run { action: "list_runs" }                              # recent runs across all transforms
transform_run { action: "list_runs", transform_id: 7, limit: 10 }
transform_run { action: "get_run", id: 118 }                       # by RUN id, not transform id
transform_run { action: "cancel", id: 7 }                          # by TRANSFORM id
```

- `list_runs` and `get_run` return the same per-run shape: `{id, transform_id, status, run_method, start_time, end_time, message}`. `response_format: "detailed"` adds the hydrated row (`is_active`, `user_id`, and the rest).
- The run id comes from `run` (`run_id`) or from `list_runs` — it is never the transform id. `get_run` takes the run id; `cancel` and `dependencies` take the transform id.
- `cancel` targets the currently-running run of a transform and returns `{transform_id, canceled: true}`.
- **Cancel semantics differ by source.** For native SQL, cancel marks the run `canceling` but does **not** kill the warehouse query mid-flight — the query runs to completion, then the run lands as `canceled` (or stays `succeeded` if the cancel arrived after the writer committed). For Python transforms the worker is interrupted directly. Don't expect cancel to free warehouse resources instantly on a long native query; expect it to flip the state and stop downstream consumers from treating the result as good.
- `transform_id` on `list_runs` filters to one transform. To compare several, call `list_runs` once per transform.

## Update: send only what changes

`transform_write` `{method: "update", id, …}` is a patch — it sends exactly the fields you pass and leaves everything else on the server alone. The writable surface is:

```
name, description, source | source_file | native, target, tags, collection_id, run_trigger
```

**Never feed a read payload back in as a write.** `get_content` returns server-side fields — `source_type`, `target_db_id`, `target_table_id`, `entity_id`, `created_at`, `updated_at`, `creator_id`, `last_run`, `table` — that are derived, not inputs. Pass the halves you are changing, not the row you read. To edit the source when you don't have a working file on disk, `{method: "pull", id}` writes the saved source to one — bare SQL for a plain-SQL transform (default `transform-<id>.sql`), the `source` JSON otherwise (default `transform-<id>.source.json`) — and its result names the update call that applies it back.

```
transform_write { method: "update", id: 7, name: "renamed" }
transform_write { method: "update", id: 7, native: { database_id: 1, sql_file: "./.scratch/orders.sql" } }
transform_write { method: "update", id: 7, tags: ["nightly"] }
```

A source-only patch keeps the name, target and tags untouched; a `tags` patch keeps the source untouched.

**`tags` are names, not ids.** A tag is the binding between a transform and the jobs that run it: a job carries tags, and it runs every transform tagged with one of them, so tagging a transform is how it gets scheduled. Names that don't exist yet are created for you (`hourly`, `daily`, `weekly`, `monthly` are seeded on every instance). **Passing `tags` replaces the transform's whole tag set** — include the tags you're keeping, not just the one you're adding.

`run_trigger` is the other half of scheduling: `none` (the default) runs the transform only when triggered — by `transform_run`, or by a job whose tag it carries — while `global-schedule` also runs it on the instance-wide transform schedule.

## Iterating on a failing transform

When a run fails and you want to retry with a fixed body, **update the transform rather than deleting and recreating it.** An update keeps the same row, `entity_id`, materialized table, and on-disk YAML filename:

- A git-sync export produces **one** clean commit containing only the fix, instead of "broken transform" + "remove broken transform" landing as two commits in the log.
- You don't chase the `_2` suffixes minted when two YAMLs share a `name` on disk.
- The materialized output table either updates in place or, if the SELECT shape changed incompatibly, errors loudly on the next run rather than landing in a parallel `..._2` table you have to clean up.

```
# 1. Try once
transform_write { method: "create", name: "orders_daily", native: {…}, target: {…} }   # → id 7
transform_run   { action: "run", id: 7 }                                               # → error: run failed, <server message>

# 2. Fix the SQL in the file, then patch the source in place.
#    (No file on disk — the transform predates this session? Recreate it first:
#     transform_write { method: "pull", id: 7 } writes the saved SQL to a file.)
transform_write { method: "update", id: 7, native: { database_id: 1, sql_file: "./.scratch/orders.sql" } }

# 3. Re-run
transform_run   { action: "run", id: 7 }                                               # → succeeded
```

If you genuinely must delete and recreate, delete **before** the first git-sync export, so the failed entity never lands in git history — an export of a soft-failed state is noise that needs a follow-up cleanup commit. See the `git-sync` skill, "Read state before mutating", for the ordering rule.

## Delete the transform

```
transform_write { method: "delete", id: 7 }
transform_write { method: "delete", id: 7, delete_target_table: true }
```

There is no trash for transforms: a delete is permanent. By default the **materialized output table stays**, and every question built on that table keeps working — the definition goes, the data doesn't. `delete_target_table: true` drops the warehouse table too, and breaks anything reading it.

## Transform jobs (schedules)

A schedule is a separate entity. A job **carries tags, not transform ids**: each run executes every transform tagged with one of the job's tags, plus those transforms' dependencies. You add a transform to a job by tagging the transform, not by listing it on the job. A job with no tags runs nothing.

```
transform_job_write { method: "create", name: "Nightly", schedule: "0 0 0 * * ?", tags: ["nightly"] }
transform_job_write { method: "update", id: 2, active: false }   # pause the schedule, keep the job
transform_job_write { method: "delete", id: 2 }                  # transforms it ran are untouched
```

**`schedule` is a 6-field Quartz cron, not a 5-field Unix cron** — `seconds minutes hours day-of-month month day-of-week`, in the instance's report timezone, with an optional trailing year. A Unix expression is one field short and would silently mean something else, so the seconds field comes first:

| Schedule                | Cron          |
| ----------------------- | ------------- |
| Nightly at midnight     | `0 0 0 * * ?` |
| Hourly on the hour      | `0 0 * * * ?` |
| Every Monday at 07:00   | `0 0 7 ? * MON` |
| Every 15 minutes        | `0 0/15 * * * ?` |

Quartz forbids naming both day-of-month and day-of-week, so exactly one of those two fields is `?`.

Reading and triggering jobs runs through `transform_run`:

```
transform_run { action: "list_jobs" }                              # every schedule
transform_run { action: "job_transforms", id: 2 }                  # which transforms this job resolves to, by tag
transform_run { action: "run_job", id: 2 }                         # trigger it now
transform_run { action: "run_job", id: 2, force_refresh: true }    # also re-run dependencies that are already fresh
```

`run_job` is fire-and-forget: it returns `{message, job_run_id}` immediately and the transforms run in the background — there is no waiting on a job. Watch them land with `{action: "list_runs"}`. Most ad-hoc work is a one-off `{action: "run"}` on a single transform, not job authoring.
