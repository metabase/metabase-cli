---
name: transform
description: Author and run Metabase transforms via `mb` — body shape (native SQL + MBQL 5), create + run-with-wait, run inspection, cancel, the `update`-vs-recreate iteration rule, and the writable-keys-only PATCH contract. Load when the user touches transforms — "create a transform", "run a transform", "fix a failing transform", "list transform runs", "cancel a running transform", or anything `mb transform …`.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

# Transforms

A **transform** persists the result of a query (native SQL or MBQL) to a warehouse table the user can read from cards, dashboards, and other transforms. It runs on a schedule (via `transform-job`) or on-demand (`transform run`).

This skill covers the create-and-run flow. The general flag conventions, body-input precedence, and output flags live in the `core` skill (`mb skills get core`).

## Body shape

A transform has two halves:

- `source` — the query to run (`type: "query"`, with `query.type` of `native` or `mbql`).
- `target` — the warehouse destination (`type: "table"`, with `database`, `schema`, `name`).

Native SQL is the simplest source and the easiest to author by hand (see "Create + run" below). MBQL is what the Metabase UI emits and is more verbose; pull a sample with `mb transform get <id> --full --json` if you need its shape.

For an **MBQL 5** `source.query` (`lib/type: "mbql/query"`), the body shape, the "options object is always second" clause rule, UUID minting, aggregation/order-by refs, naming aggregation output columns, and the `--print-schema` → `--dry-run` validation loop are all in the `mbql` skill — **`mb skills get mbql`**. The MBQL-5 pre-flight on `transform create`/`update` is documented there too (legacy MBQL 4 and native sources skip it). For a transform target, naming your aggregation output columns matters more than usual — a bare `count` / `avg_2` becomes the warehouse column name; see the `mbql` skill's "Naming aggregation output columns".

## Create + run (native SQL)

```bash
cat > /tmp/transform.json <<'EOF'
{
  "name": "user_counts_by_signup_year",
  "description": "Sample transform: counts users by year of signup",
  "source": {
    "type": "query",
    "query": {
      "type": "native",
      "database": <db-id>,
      "native": {
        "query": "SELECT date_trunc('year', created_at)::date AS signup_year, COUNT(*)::int AS user_count FROM public.users GROUP BY 1 ORDER BY 1"
      }
    }
  },
  "target": {
    "type": "table",
    "database": <db-id>,
    "schema": "public",
    "name": "user_counts_by_signup_year"
  }
}
EOF

TRANSFORM_ID=$(mb transform create --file /tmp/transform.json --profile <name> --json | jq -r '.id')
mb transform run "$TRANSFORM_ID" --wait --profile <name> --json
```

Notes:

- `<db-id>` comes from `mb database list --profile <name> --json`. Database ids are per-instance.
- Target `schema` is the schema the result table is written into (e.g. `public`).
- `--wait` on `transform run` polls until status is `succeeded` or `failed`. Without it you only get `{message: "Transform run started", run_id, final: null}` and have to poll yourself.
- The `--json` envelope is shape-stable: `{message, run_id, final}`. `final` is always present — `null` when `--wait` is omitted or the run never started, otherwise a full `TransformRun` object with `status` and `message`. On a failed run (`final.status` ∈ {`failed`, `timeout`, `canceled`}) the CLI exits 1 and writes a one-line summary `transform run <id> failed` to stderr; the failure detail lives only in `final.message` on stdout, so `jq -r '.final.message'` is where to look.
- The heredoc with single-quoted `'EOF'` prevents shell from interpolating any `$vars` inside the SQL.
- `transform create --json` returns the agent-facing compact projection: `{id, name, description, source_type, target: {type, database, schema, name}, target_db_id}`. Read `target.schema`/`target.name` directly off the create output — no follow-up `transform get` needed to verify where the transform will write.
- If a transform with the same `name` already has a YAML representation on disk under the configured remote-sync repo, `create` mints a `_2` suffix on the exported filename (the new transform gets a fresh `entity_id`; the prior one isn't touched). For "iterate on the same concept" workflows, prefer `transform update <id>` — see "Iterating on a failing transform" below.
- **`collection_id` only accepts a collection in the `:transforms` namespace.** Transforms aren't filed next to cards and dashboards — passing a normal analytics collection id (the kind a dashboard lives in) fails create/update with `collection_id: A Transform can only go in Collections in the :transforms namespace.` Omit `collection_id` to leave the transform uncollected (the common case), or pass a collection created in the transforms namespace. Cards and dashboards you build **on top of** the transform's output table go in ordinary collections as usual — so "put the transform and its dashboard in collection X" generally means _X holds the dashboard + cards; the transform stays in the transforms namespace._

## Inspect

```bash
mb transform list --profile <name> --json
mb transform get <id> --profile <name> --full --json     # full transform incl. last run summary
```

After a run, the materialized table physically exists in the warehouse, but Metabase doesn't know about it yet. **Native SQL** (a native `card`, or `mb query` against `<schema>.<name>`) reads it immediately — native runs straight against the warehouse. **MBQL and the Metabase UI cannot reference it until the instance syncs**, because they address tables and columns by numeric id and a brand-new table has none. To build MBQL cards on a fresh output table:

```bash
mb database sync-schema <db-id> --profile <name> --json          # async — returns {status:"ok"} at once
# poll until the new table appears (sync is not instant):
mb database schema-tables <db-id> <schema> --profile <name> --json --fields id,name
mb table get <table-id> --include fields --profile <name> --json  # then grab the field ids
```

Columns and types are inferred from the result set; if you change the SELECT shape, drop the table first (`transform delete-table <id>`) or the next run will fail on a column-mismatch error. A changed shape also needs a re-sync before MBQL sees the new/renamed columns.

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

Notes:

- `transform runs` and `transform get-run` parse against the same `TransformRun` schema, so `get-run` returns the same per-run shape as one entry of `runs`. The compact projection is `{id, transform_id, status, run_method, start_time, end_time, message}`. Pass `--full` on `get-run` for the hydrated row including `is_active`, `user_id`, `transform_name`, `transform_entity_id`, `checkpoint_*` fields, and a nested `transform: {id, name, …}` block.
- `transform cancel` takes the **transform** id and 404s with `Endpoint not found — is this a Metabase instance?` if there is no active run. The response shape is `{canceled: true, id: <transform-id>}`.
- For native-SQL transforms, cancel marks the run as `canceling` but does **not** kill the warehouse query mid-flight — the query runs to completion, then the run lands as `canceled` (or stays `succeeded` if the cancel arrived after the writer committed). For Python transforms the worker is interrupted directly. Don't expect cancel to free warehouse resources instantly on long native queries; expect it to flip state and prevent downstream consumers from treating the result as good.
- The `--transform-id` filter on `runs` accepts a single integer; the CLI translates to the server's `transform-ids` query vector. To cross-filter multiple transforms, run `transform runs --json` and `jq` post-hoc.

## Update body: send only writable keys, never round-trip the GET body

`transform update <id>` is **PATCH semantics** — only send the fields you actually want to change. The endpoint accepts exactly these writable keys:

```
name, description, source, target, run_trigger,
tag_ids, collection_id, owner_user_id, owner_email
```

**Don't paste the output of `transform get` into a `transform update` body.** The GET response carries server-side fields (`id`, `entity_id`, `created_at`, `updated_at`, `creator_id`, `last_run`, `target_db_id`, `target_table_id`, `source_type`, `source_database_id`, `source_readable`, `creator`, `owner`, `table`, …) that the PUT endpoint isn't built to handle. Currently, unknown top-level keys flow into `t2/update!` and produce a leaked H2 SQL error like:

```
Column "TAGS" not found; SQL statement:
UPDATE "TRANSFORM" SET "TAGS" = (), "UPDATED_AT" = NOW() WHERE "ID" = ? [42122-214]
```

Three specific footguns:

- **`tags` is not a key on the REST API.** The serdes/YAML representation uses `tags`; the REST contract uses `tag_ids` (an array of integer ids). If you pulled a YAML representation and want to PUT it, translate `tags: [...]` → `tag_ids: [...]` first (or omit it entirely if you're not changing tag membership).
- **`source_type`, `target_db_id`, `target_table_id`, `entity_id`** are derived/computed by the server. They appear in GET responses for the agent's benefit; the server doesn't accept them on update.
- **`collection_id` must be a `:transforms`-namespace collection** — a regular card/dashboard collection id is rejected with `A Transform can only go in Collections in the :transforms namespace.` Omit it unless you have one (see the create notes above). Round-tripping the existing value is safe; setting it to an ordinary collection is what fails.

Right shape — patch only what changes:

```bash
# Rename only:
mb transform update <id> --body '{"name":"renamed"}' --profile <name> --json

# Rewrite the SQL only:
cat > /tmp/patch.json <<'EOF'
{ "source": { "type": "query", "query": { "type": "native",
    "database": <db-id>,
    "native": { "query": "SELECT … FROM public.orders" } } } }
EOF
mb transform update <id> --file /tmp/patch.json --profile <name> --json

# Change tag membership (note: tag_ids, not tags):
mb transform update <id> --body '{"tag_ids":[1,3]}' --profile <name> --json
```

If you really must round-trip, project to the writable subset:

```bash
mb transform get <id> --full --profile <name> --json \
  | jq '{name, description, source, target, run_trigger, tag_ids, collection_id, owner_user_id, owner_email}
        | with_entries(select(.value != null))' \
  > /tmp/patch.json
```

## Iterating on a failing transform

When `transform run` fails and you want to retry with a fixed body, **prefer `transform update <id> --file body.json` over `transform delete <id>` + `transform create`.** Update keeps the same row, the same `entity_id`, the same materialized table, and the same on-disk YAML filename. Concretely this means:

- `git-sync export` produces **one** clean commit containing only the fix, instead of "broken transform" + "remove broken transform" landing as two commits in `git log`.
- You don't have to chase `_2` suffixes minted when two YAMLs share a `name` on disk (see the `transform create` notes above).
- The materialized output table either updates in place or, if the SELECT shape changed incompatibly, errors loudly on the next run rather than landing in a parallel `..._2` table the agent has to clean up. (`transform delete-table <id>` resets the column shape if you need a clean slate.)

Recipe:

```bash
# 1. Try once
ID=$(mb transform create --file /tmp/t.json --profile <n> --json | jq -r '.id')
mb transform run "$ID" --wait --profile <n> --json     # → failed

# 2. Fix the body in place; PATCH only what changed.
#    Source-only patch — keeps name, target, tags untouched on the server.
cat > /tmp/source-patch.json <<'EOF'
{ "source": { "type": "query", "query": { "type": "native",
    "database": <db-id>,
    "native": { "query": "<fixed SQL here>" } } } }
EOF
mb transform update "$ID" --file /tmp/source-patch.json --profile <n> --json

# 3. Re-run
mb transform run "$ID" --wait --profile <n> --json     # → succeeded
```

If you really must `create + delete` instead, do the `delete` **before** the first `git-sync export` so the failed entity never lands in git history. Order matters: agents reflex to "export to checkpoint progress," but for transforms an export of a soft-failed state is mostly noise that needs a follow-up cleanup commit. See the `git-sync` skill, "Read state before mutating" for the ordering rule.

## Drop the materialized table (keep the transform)

```bash
mb transform delete-table <id> --yes --profile <name>
```

Useful when you've changed the SELECT and want a fresh `CREATE TABLE` on the next run. **`--yes` is required** in non-interactive contexts; without it the command exits with `--yes required to delete non-interactively`.

## Delete the transform

```bash
mb transform delete <id> --yes --profile <name>
```

Removes the definition. Whether the materialized table is dropped depends on the server — check with `mb table list --db-id <db-id> --profile <name> --json` if it matters. Same `--yes` rule as `delete-table`.

## Transform jobs (schedules)

A schedule lives in a separate resource (`transform-job`) and references one or more transform ids. Create with the same body-input pattern (`--file body.json`); see `mb transform-job --help` for the verb list. Most ad-hoc agent work is one-off `transform run`, not job authoring.

## Don't (transform-specific)

- Don't put `transform run` calls in tight polling loops — pass `--wait` and let the CLI handle the polling. Manual loops without `--wait` will hammer the server.
- Don't author MBQL 4 (the legacy nested `{ type: "query", query: {...} }` shape) by hand — pull a sample with `mb transform get <id> --full --json`. MBQL 5 (`lib/type: "mbql/query"`) **is** authorable by hand thanks to the `mb query --print-schema` + `--dry-run` feedback loop; for non-trivial pipelines you may still prefer building in the UI and exporting.
- Don't paste a `transform get` body into `transform update` — the PUT endpoint only accepts writable keys, and unknown keys (notably `tags`, `source_type`, `entity_id`, `created_at`, `last_run`) leak as raw SQL errors. See "Update body: send only writable keys" above. Use `tag_ids` (not `tags`) on the REST contract.
