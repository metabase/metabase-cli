---
name: transform
description: Author and run Metabase transforms via `mb` — body shape (native SQL + MBQL 5), create + run-with-wait, run inspection, dependencies, cancel, the `update`-vs-recreate iteration rule, the writable-keys-only PATCH contract, plus transform tags and tag-driven transform-job schedules. Load when the user touches transforms — "create a transform", "run a transform", "fix a failing transform", "list transform runs", "cancel a running transform", "manage transform tags", "run a transform job", or anything `mb transform …` / `mb transform-job …` / `mb transform-tag …`.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

# Transforms

A **transform** persists the result of a query (native SQL or MBQL) to a warehouse table the user can read from cards, dashboards, and other transforms. It runs on a schedule (via `transform-job`) or on-demand (`transform run`).

Flag conventions, body-input precedence, and the `./.scratch` convention live in `core` (`mb skills get core`). Deciding _which_ transforms to build — modeling a whole raw database into clean, analysis-ready tables — is the `data-workflow` skill's build-clean-tables stage (`mb skills get data-workflow`).

## Body shape

A transform has two halves:

- `source` — the query to run (`type: "query"`, with `query.type` of `native` or `mbql`).
- `target` — the warehouse destination (`type: "table"`, with `database`, `schema`, `name`).

Native SQL is the simplest source and the easiest to author by hand. For an **MBQL 5** `source.query` (`lib/type: "mbql/query"`) — the body shape, the options-object-is-always-second clause rule, UUID minting, aggregation/order-by refs, naming aggregation output columns, the `--print-schema` → `--dry-run` validation loop, and the MBQL-5 pre-flight that `transform create`/`update` run (legacy MBQL 4 and native sources skip it) — see `mbql` (**`mb skills get mbql`**). Pull a sample MBQL body with `mb transform get <id> --full --json`. For a transform target, naming aggregation output columns matters more than usual: a bare `count` / `avg_2` becomes the warehouse column name.

## Create + run (native SQL)

**Keep the SQL formatted.** Author it multi-line in `./.scratch/<name>.sql` and embed with `jq --rawfile` (jq ≥1.6, which JSON-encodes the file so newlines become `\n`). The stored `native.query` is what `mb transform get` and the Metabase editor render — a single-line blob is valid JSON but unreadable when anyone opens the transform. Single-quote the heredoc delimiter (`<<'SQL'`) so the shell leaves `$vars` in the query alone (e.g. Postgres `$1`, `$$`).

```bash
cat > ./.scratch/user_counts_by_signup_year.sql <<'SQL'
SELECT
  date_trunc('year', created_at)::date AS signup_year,
  COUNT(*)::int                        AS user_count
FROM public.users
GROUP BY 1
ORDER BY 1
SQL

jq -n --rawfile q ./.scratch/user_counts_by_signup_year.sql \
  '{ name: "user_counts_by_signup_year",
     description: "Sample transform: counts users by year of signup",
     source: { type: "query", query: { type: "native", database: <db-id>, native: { query: $q } } },
     target: { type: "table", database: <db-id>, schema: "public", name: "user_counts_by_signup_year" } }' \
  > ./.scratch/transform.json

TRANSFORM_ID=$(mb transform create --file ./.scratch/transform.json --profile <name> --json | jq -r '.id')
mb transform run "$TRANSFORM_ID" --wait --profile <name> --json
```

- `<db-id>` comes from `mb database list --profile <name> --json`; ids are per-instance. Target `schema` is the schema the result table is written into (e.g. `public`).
- `--wait` polls until status is `succeeded` or `failed`. Without it you get only `{message: "Transform run started", run_id, final: null}` and must poll yourself — don't put bare `transform run` in a tight loop; let `--wait` do the polling.
- `--sync` implies `--wait`, then waits until the run registers its output table (the run registers it itself — no `db sync-schema` needed), adding `target_table_id` to the envelope. Use it when you'll build MBQL on the output (see "Inspect").
- The `--json` envelope is shape-stable: `{message, run_id, final}` (plus `target_table_id` under `--sync` — a number, or `null` if the table didn't register before the timeout). `final` is `null` when `--wait` is omitted or the run never started, otherwise a full `TransformRun` with `status` and `message`. On a failed run (`final.status` ∈ {`failed`, `timeout`, `canceled`}) the CLI exits 1 and writes a one-line `transform run <id> failed` to stderr; the failure detail lives only in `final.message` on stdout, so `jq -r '.final.message'` is where to look.
- `transform create --json` returns the agent-facing compact projection: `{id, name, description, source_type, target: {type, database, schema, name}, target_db_id}`. Read `target.schema`/`target.name` directly off it — no follow-up `transform get`.
- If a transform with the same `name` already has a YAML representation on disk under the configured remote-sync repo, `create` mints a `_2` suffix on the exported filename (the new transform gets a fresh `entity_id`; the prior one isn't touched). For "iterate on the same concept", prefer `transform update <id>` — see "Iterating on a failing transform".
- **`collection_id` only accepts a collection in the `:transforms` namespace.** Transforms aren't filed next to cards and dashboards — a normal analytics collection id fails create/update with `collection_id: A Transform can only go in Collections in the :transforms namespace.` Omit `collection_id` to leave the transform uncollected (the common case), or provision one with `mb collection create --body '{"name":"…"}' --namespace transforms --json` (see `core`) and pass the returned `id`. Cards and dashboards you build **on top of** the output table go in ordinary collections — so "put the transform and its dashboard in collection X" means _X holds the dashboard + cards; the transform stays in the transforms namespace._

## Inspect

```bash
mb transform list --profile <name> --json
mb transform get <id> --profile <name> --full --json          # full transform incl. last run summary
mb transform dependencies <id> --profile <name> --json        # upstream transforms this one must run after
```

After a run the table physically exists in the warehouse, but Metabase addresses tables/columns by numeric id, so **MBQL and the UI can't reference a brand-new table until the instance syncs** (native SQL — a native `card` or `mb query` against `<schema>.<name>` — reads it immediately). Run and register in one step with `--sync`:

```bash
TABLE_ID=$(mb transform run <id> --sync --profile <name> --json | jq -r '.target_table_id')
mb table get "$TABLE_ID" --include fields --profile <name> --json   # field ids for MBQL
```

On `target_table_id: null` (still syncing when the poll timed out; exit 0) re-poll `mb transform get <id> --full --json` until the `target_table_id` / `table` linkage lands.

Columns and types are inferred from the result set; change the SELECT shape and the next run fails on a column mismatch — drop the table first (`transform delete-table <id>`). A changed shape also needs a re-run with `--sync` before MBQL sees the new/renamed columns.

## Inspect runs and cancel an in-flight run

```bash
# Recent runs across all transforms (drains all pages by default; cap with --limit):
mb transform runs --profile <name> --json
mb transform runs --transform-id <id> --limit 10 --profile <name> --json

# Fetch one run by RUN id (NOT transform id — the run id comes from `transform run` or `transform runs`):
mb transform get-run <run-id> --profile <name> --json

# Cancel the currently-running run for a transform:
mb transform cancel <id> --profile <name> --json
```

- `transform runs` and `transform get-run` parse against the same `TransformRun` schema, so `get-run` returns the same per-run shape as one entry of `runs`. The compact projection is `{id, transform_id, status, run_method, start_time, end_time, message}`. Pass `--full` on `get-run` for the hydrated row including `is_active`, `user_id`, `transform_name`, `transform_entity_id`, `checkpoint_*` fields, and a nested `transform: {id, name, …}` block.
- `transform cancel` takes the **transform** id and returns `{canceled: true, id: <transform-id>}`. It 404s with `Endpoint not found — is this a Metabase instance?` if there is no active run.
- **Cancel semantics differ by source.** For native SQL, cancel marks the run `canceling` but does **not** kill the warehouse query mid-flight — the query runs to completion, then the run lands as `canceled` (or stays `succeeded` if the cancel arrived after the writer committed). For Python transforms the worker is interrupted directly. Don't expect cancel to free warehouse resources instantly on long native queries; expect it to flip state and prevent downstream consumers from treating the result as good.
- The `--transform-id` filter on `runs` accepts a single integer (translated to the server's `transform-ids` vector). To cross-filter multiple transforms, run `transform runs --json` and `jq` post-hoc.

## Update body: send only writable keys, never round-trip the GET body

`transform update <id>` is **PATCH semantics** — only send the fields you want to change. The endpoint accepts exactly these writable keys:

```
name, description, source, target, run_trigger,
tag_ids, collection_id, owner_user_id, owner_email
```

**Never paste the output of `transform get` into a `transform update` body.** The GET response carries server-side fields (`id`, `entity_id`, `created_at`, `updated_at`, `creator_id`, `last_run`, `target_db_id`, `target_table_id`, `source_type`, `source_database_id`, `source_readable`, `creator`, `owner`, `table`, …) that the PUT endpoint isn't built to handle. Unknown top-level keys flow into `t2/update!` and leak a raw H2 SQL error like:

```
Column "TAGS" not found; SQL statement:
UPDATE "TRANSFORM" SET "TAGS" = (), "UPDATED_AT" = NOW() WHERE "ID" = ? [42122-214]
```

Three specific footguns:

- **`tags` is not a REST key.** The serdes/YAML representation uses `tags`; the REST contract uses `tag_ids` (an array of integer ids). If you pulled a YAML representation and want to PUT it, translate `tags: [...]` → `tag_ids: [...]` first (or omit it if you're not changing tag membership).
- **`source_type`, `target_db_id`, `target_table_id`, `entity_id`** are derived/computed by the server. They appear in GET responses for the agent's benefit; the server doesn't accept them on update.
- **`collection_id` must be a `:transforms`-namespace collection** — a regular card/dashboard collection id is rejected with `A Transform can only go in Collections in the :transforms namespace.` Round-tripping the existing value is safe; setting it to an ordinary collection is what fails.

Patch only what changes:

```bash
# Rename only:
mb transform update <id> --body '{"name":"renamed"}' --profile <name> --json

# Rewrite the SQL only — author it formatted, embed with jq:
cat > ./.scratch/orders.sql <<'SQL'
SELECT …
FROM public.orders
SQL
jq -n --rawfile q ./.scratch/orders.sql \
  '{ source: { type: "query", query: { type: "native", database: <db-id>, native: { query: $q } } } }' \
  > ./.scratch/patch.json
mb transform update <id> --file ./.scratch/patch.json --profile <name> --json

# Change tag membership (note: tag_ids, not tags):
mb transform update <id> --body '{"tag_ids":[1,3]}' --profile <name> --json
```

`tag_ids` are the integer ids of **transform tags** — manage them with the `transform-tag` group: `mb transform-tag list --json` (find ids; the four built-ins `hourly`/`daily`/`weekly`/`monthly` are seeded), `mb transform-tag create --body '{"name":"nightly"}' --json`, `mb transform-tag update <id>`, `mb transform-tag delete <id>`. Tags are also how a `transform-job` selects what to run — a job executes every transform carrying one of the job's tags (see "Transform jobs").

If you really must round-trip, project to the writable subset:

```bash
mb transform get <id> --full --profile <name> --json \
  | jq '{name, description, source, target, run_trigger, tag_ids, collection_id, owner_user_id, owner_email}
        | with_entries(select(.value != null))' \
  > ./.scratch/patch.json
```

## Iterating on a failing transform

When `transform run` fails and you want to retry with a fixed body, **prefer `transform update <id> --file body.json` over `transform delete <id>` + `transform create`.** Update keeps the same row, `entity_id`, materialized table, and on-disk YAML filename:

- `git-sync export` produces **one** clean commit containing only the fix, instead of "broken transform" + "remove broken transform" landing as two commits in `git log`.
- You don't chase `_2` suffixes minted when two YAMLs share a `name` on disk.
- The materialized output table either updates in place or, if the SELECT shape changed incompatibly, errors loudly on the next run rather than landing in a parallel `..._2` table you have to clean up. (`transform delete-table <id>` resets the column shape for a clean slate.)

```bash
# 1. Try once
ID=$(mb transform create --file ./.scratch/t.json --profile <n> --json | jq -r '.id')
mb transform run "$ID" --wait --profile <n> --json     # → failed

# 2. Fix the body in place; PATCH only what changed.
#    Source-only patch — keeps name, target, tags untouched on the server.
cat > ./.scratch/source.sql <<'SQL'
<fixed SQL, formatted>
SQL
jq -n --rawfile q ./.scratch/source.sql \
  '{ source: { type: "query", query: { type: "native", database: <db-id>, native: { query: $q } } } }' \
  > ./.scratch/source-patch.json
mb transform update "$ID" --file ./.scratch/source-patch.json --profile <n> --json

# 3. Re-run
mb transform run "$ID" --wait --profile <n> --json     # → succeeded
```

If you really must `create + delete` instead, do the `delete` **before** the first `git-sync export` so the failed entity never lands in git history — an export of a soft-failed state is noise that needs a follow-up cleanup commit. See `git-sync`, "Read state before mutating", for the ordering rule.

## Drop the materialized table (keep the transform)

```bash
mb transform delete-table <id> --yes --profile <name>
```

Useful when you've changed the SELECT and want a fresh `CREATE TABLE` on the next run. **`--yes` is required** non-interactively; without it the command exits with `refusing to delete <id> without confirmation — pass --yes to proceed non-interactively`.

## Delete the transform

```bash
mb transform delete <id> --yes --profile <name>
```

Removes the definition. Whether the materialized table is dropped depends on the server — check with `mb table list --db-id <db-id> --profile <name> --json` if it matters. Same `--yes` rule and message as `delete-table`.

## Transform jobs (schedules)

A schedule lives in a separate resource (`transform-job`). A job carries **tags** (`tag_ids`), not transform ids: each run executes every transform carrying one of the job's tags. You add a transform to a job by tagging the transform (`transform update <id> --body '{"tag_ids":[…]}'`), not by listing it on the job. Create/update with the same body-input pattern (`--file body.json`).

Key verbs (`mb transform-job --help` for the full list):

```bash
mb transform-job transforms <id> --profile <name> --json   # preview which transforms this job resolves to (by tag)
mb transform-job run <id> --profile <name> --json          # trigger a job now; runs all its tagged transforms
mb transform-job run <id> --force-refresh --profile <name> --json   # also re-run dependencies that are already fresh
mb transform-job set-active false --profile <name> --json  # disable every job at once (true re-enables); admin only
```

`transform-job run` is fire-and-forget — the server returns `{message, job_run_id}` immediately, with no per-job-run polling (no `--wait`). Most ad-hoc agent work is one-off `transform run`, not job authoring.
