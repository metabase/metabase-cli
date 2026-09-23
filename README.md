# Metabase RDE CLI

The `mb` command the Metabase RDE desktop app puts on every agent session's `PATH`. It reads the connected Metabase (databases, tables, cards, dashboards, collections, transforms, the Library, remote sync), runs queries and transforms, validates repository content against the representation schemas, extracts database metadata, and serves the bundled agent skills. Content itself is files in the repository; the app's remote sync puts a branch into Metabase.

The package is `@metabase/rde-cli`, private, built to `packages/cli/dist/cli.mjs` and bundled by the desktop app together with `packages/cli/skill-data/`. It is never installed from npm.

## Desktop app

`packages/desktop` is the app that bundles this CLI. [docs/desktop.md](docs/desktop.md) covers installing it, the first run, the content loop, where the app keeps its state and how `mb` inside a session authenticates. `bun run dist:desktop:linux`, `dist:desktop:mac` or `dist:desktop:win` builds an installer.

## Supported Metabase versions

The CLI is built against Metabase majors **58 through 64** (the client's `KNOWN_RANGE`), the latest patch of each; a newer server, or a head build whose version tag does not parse, runs as a head build past the newest known major — every shape the client knows head answers with, and one stderr notice per run — and an older one keeps its real major, gets one stderr notice per run pointing at a Metabase upgrade, and is refused command by command with the version it needs.

Every command declares the client methods it calls, and each method names the server features it needs — a feature is a minimum major version, a premium token feature, or both. For a command whose methods need a feature, a preflight check runs before the first request and refuses with an actionable message (exit code `2`) when:

- the server is older than the command's minimum version, or
- the command needs a premium feature (e.g. `remote_sync`, `library`, `transforms-testing`) that isn't enabled.

Plain OSS commands against a v0.58+ server (the majority) carry no elevated requirement and skip the preflight entirely. The server's version and token features come from one probe of `/api/session/properties`, cached for an hour under `$XDG_CACHE_HOME/metabase-rde/` (`%LOCALAPPDATA%\metabase-rde` on Windows) keyed by the server URL, so a session of many `mb` calls pays one probe; a server that cannot be reached fails the command with that network error. To bypass the check for a single run, pass `--skip-preflight`; to bypass it process-wide, set `MB_CLI_SKIP_PREFLIGHT=1`. Both switch off the client's own check too, so every request goes to the wire and the server answers for itself — footguns, only for servers you know are patched.

A response the CLI cannot parse, or a refusal it issues, under a cached probe triggers one fresh probe: if the server's version or premium features changed since the cache was written, the cache is refreshed and the error says so — retry the command.

## Credential

`mb` takes its credential from the environment and nothing else, in this order:

1. `MB_AUTH_BROKER` and `MB_AUTH_BROKER_TOKEN`: the desktop app's token broker. The app sets both on every agent session together with `MB_URL`, answers `GET /v1/credential` with the connected user's token (or an API key) for the connected server, and renews it on `POST /v1/credential/refresh`, which the CLI calls once when Metabase answers 401. `MB_URL`, when set, must name the server the broker serves; a mismatch is a `ConfigError` naming both.
2. `MB_URL` and `MB_API_KEY`: the developer and e2e path.

With either source, `MB_WORKTREE_ID` names a remote-sync worktree, and every request then carries it as `X-Metabase-Worktree-Id`, so every command acts inside that worktree. A value that is not a positive integer is a `ConfigError` naming the variable.

With neither, every command that reaches a server exits `2` with `no Metabase credential; run inside Metabase RDE, or set MB_URL and MB_API_KEY`. There are no profiles, no keyring, no config directory and no login command.

## Build from source

```sh
bun install
bun run build
node packages/cli/dist/cli.mjs --help
```

The binary is `mb`. Examples below use that name. `bin/mb-dev` runs the CLI straight from source with the probe cache under `.dev-state/`.

## Commands

Every leaf command, as `mb --help --json` lists them. `packages/cli/src/commands/surface.test.ts` holds this table and the help index to the same list.

| Command                          | What it does                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mb db list`                     | List databases                                                                                                                                                                                                                                                                                                                                                                 |
| `mb db get`                      | Get a database by id                                                                                                                                                                                                                                                                                                                                                           |
| `mb db schemas`                  | List schemas in a database                                                                                                                                                                                                                                                                                                                                                     |
| `mb db schema-tables`            | List tables in a database schema                                                                                                                                                                                                                                                                                                                                               |
| `mb db sync-schema`              | Trigger a manual schema sync for a database                                                                                                                                                                                                                                                                                                                                    |
| `mb db rescan-values`            | Trigger a rescan of cached field values for a database                                                                                                                                                                                                                                                                                                                         |
| `mb table list`                  | List tables (optionally filtered by database)                                                                                                                                                                                                                                                                                                                                  |
| `mb table get`                   | Get a table by id; pass --include fields to bundle hydrated fields                                                                                                                                                                                                                                                                                                             |
| `mb table fields`                | List fields on a table (projection over query_metadata.fields)                                                                                                                                                                                                                                                                                                                 |
| `mb field get`                   | Get a field by id                                                                                                                                                                                                                                                                                                                                                              |
| `mb field values`                | Fetch the cached distinct values for a field (FieldValues list)                                                                                                                                                                                                                                                                                                                |
| `mb field summary`               | Get the row count and distinct count for a field                                                                                                                                                                                                                                                                                                                               |
| `mb card list`                   | List cards (questions, models, metrics)                                                                                                                                                                                                                                                                                                                                        |
| `mb card get`                    | Get a card by id                                                                                                                                                                                                                                                                                                                                                               |
| `mb card query`                  | Run a saved card and return results (json envelope, or stream CSV/JSON/XLSX via --export-format)                                                                                                                                                                                                                                                                               |
| `mb dashboard list`              | List dashboards                                                                                                                                                                                                                                                                                                                                                                |
| `mb dashboard get`               | Get a dashboard by id                                                                                                                                                                                                                                                                                                                                                          |
| `mb dashboard cards`             | List dashcards on a dashboard                                                                                                                                                                                                                                                                                                                                                  |
| `mb dashboard parameter-values`  | Fetch the selectable values for a dashboard parameter                                                                                                                                                                                                                                                                                                                          |
| `mb collection list`             | List collections                                                                                                                                                                                                                                                                                                                                                               |
| `mb collection get`              | Get a collection by id, 21-char entity id, or "root"/"trash"                                                                                                                                                                                                                                                                                                                   |
| `mb collection items`            | List items inside a collection                                                                                                                                                                                                                                                                                                                                                 |
| `mb collection tree`             | Fetch the collection hierarchy as a nested tree (JSON only)                                                                                                                                                                                                                                                                                                                    |
| `mb library get`                 | Show the Library and its Data / Metrics collection ids                                                                                                                                                                                                                                                                                                                         |
| `mb library publish`             | Publish tables (and their upstream dependencies) to the Library Data collection                                                                                                                                                                                                                                                                                                |
| `mb library unpublish`           | Unpublish tables (and their downstream dependents) from the Library                                                                                                                                                                                                                                                                                                            |
| `mb document list`               | List documents                                                                                                                                                                                                                                                                                                                                                                 |
| `mb document get`                | Get a document by id                                                                                                                                                                                                                                                                                                                                                           |
| `mb transform list`              | List transforms                                                                                                                                                                                                                                                                                                                                                                |
| `mb transform get`               | Get a transform by id                                                                                                                                                                                                                                                                                                                                                          |
| `mb transform dependencies`      | List the transforms a transform depends on                                                                                                                                                                                                                                                                                                                                     |
| `mb transform run`               | Trigger a transform run by id                                                                                                                                                                                                                                                                                                                                                  |
| `mb transform cancel`            | Cancel the current run for a transform                                                                                                                                                                                                                                                                                                                                         |
| `mb transform get-run`           | Get a transform run by run id (not the transform id)                                                                                                                                                                                                                                                                                                                           |
| `mb transform runs`              | List recent transform runs                                                                                                                                                                                                                                                                                                                                                     |
| `mb transform-job list`          | List transform jobs                                                                                                                                                                                                                                                                                                                                                            |
| `mb transform-job get`           | Get a transform job by id                                                                                                                                                                                                                                                                                                                                                      |
| `mb transform-job run`           | Trigger a transform job run by id                                                                                                                                                                                                                                                                                                                                              |
| `mb transform-job transforms`    | List the transforms a job will run                                                                                                                                                                                                                                                                                                                                             |
| `mb transform-tag list`          | List transform tags                                                                                                                                                                                                                                                                                                                                                            |
| `mb transform-test list`         | List transform tests, optionally those of one transform                                                                                                                                                                                                                                                                                                                        |
| `mb transform-test get`          | Get a transform test by id                                                                                                                                                                                                                                                                                                                                                     |
| `mb transform-test create`       | Create a transform test                                                                                                                                                                                                                                                                                                                                                        |
| `mb transform-test update`       | Update a transform test by id                                                                                                                                                                                                                                                                                                                                                  |
| `mb transform-test delete`       | Delete a transform test by id                                                                                                                                                                                                                                                                                                                                                  |
| `mb transform-test run`          | Run a transform test by id and report each expectation                                                                                                                                                                                                                                                                                                                         |
| `mb metadata extract`            | Export the warehouse metadata and write it as one YAML file per database and table                                                                                                                                                                                                                                                                                             |
| `mb search`                      | Search Metabase content (cards, dashboards, collections, …)                                                                                                                                                                                                                                                                                                                    |
| `mb git-sync status`             | Show current git-sync state (branch, dirty, current task)                                                                                                                                                                                                                                                                                                                      |
| `mb git-sync tree`               | List the synced collections, their hierarchy, and the items in each                                                                                                                                                                                                                                                                                                            |
| `mb git-sync is-dirty`           | Check whether Metabase has unsynced local changes                                                                                                                                                                                                                                                                                                                              |
| `mb git-sync has-remote-changes` | Check whether the remote branch has unimported changes                                                                                                                                                                                                                                                                                                                         |
| `mb git-sync dirty`              | List objects with unsynced local changes                                                                                                                                                                                                                                                                                                                                       |
| `mb git-sync current-task`       | Get the most recent git-sync task (or idle if none)                                                                                                                                                                                                                                                                                                                            |
| `mb git-sync cancel-task`        | Cancel the running git-sync task                                                                                                                                                                                                                                                                                                                                               |
| `mb git-sync wait`               | Poll the current git-sync task until it reaches a terminal status                                                                                                                                                                                                                                                                                                              |
| `mb git-sync import`             | Import content from the configured git remote into Metabase                                                                                                                                                                                                                                                                                                                    |
| `mb git-sync branches`           | List branches on the configured git remote                                                                                                                                                                                                                                                                                                                                     |
| `mb git-sync worktree list`      | List remote-sync worktrees                                                                                                                                                                                                                                                                                                                                                     |
| `mb git-sync worktree ensure`    | Get the worktree for a branch, creating it when the branch has none                                                                                                                                                                                                                                                                                                            |
| `mb git-sync worktree delete`    | Delete a worktree and every piece of content it checked out                                                                                                                                                                                                                                                                                                                    |
| `mb snippet list`                | List native query snippets                                                                                                                                                                                                                                                                                                                                                     |
| `mb snippet get`                 | Get a native query snippet by id                                                                                                                                                                                                                                                                                                                                               |
| `mb segment list`                | List segments                                                                                                                                                                                                                                                                                                                                                                  |
| `mb segment get`                 | Get a segment by id                                                                                                                                                                                                                                                                                                                                                            |
| `mb measure list`                | List measures                                                                                                                                                                                                                                                                                                                                                                  |
| `mb measure get`                 | Get a measure by id                                                                                                                                                                                                                                                                                                                                                            |
| `mb eid`                         | Translate Metabase entity ids (string EIDs) to numeric ids                                                                                                                                                                                                                                                                                                                     |
| `mb entity-id`                   | Mint entity ids for new content files                                                                                                                                                                                                                                                                                                                                          |
| `mb query`                       | Run an ad-hoc MBQL or native query                                                                                                                                                                                                                                                                                                                                             |
| `mb uuid`                        | Mint random UUID v4 strings                                                                                                                                                                                                                                                                                                                                                    |
| `mb validate`                    | Check repository content files against the representation schemas                                                                                                                                                                                                                                                                                                              |
| `mb skills list`                 | List CLI-bundled skills — always consult the matching skill before acting on a task; they are the source of truth for every workflow. Skills the connected server cannot use are left out; --unfiltered lists them too.                                                                                                                                                        |
| `mb skills get`                  | Print one or more skills' SKILL.md content, as the connected server can use it: a skill it lacks the features for is reported under `unavailable`, and a section it cannot use is left out. Pass comma-separated names, or --all for every non-hidden skill. --unfiltered prints the selection as written, regardless of the server. --full includes references and templates. |
| `mb skills path`                 | Print the absolute path to a skill (or all skills). Useful when an agent needs to read the SKILL.md or its references with the Read tool directly.                                                                                                                                                                                                                             |

## Output

Every `list` and `get` verb takes the same output flags. The per-command flag tables below list only what is specific to that command.

| Flag                | Description                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `--json`            | Emit JSON. Auto-enabled on non-TTY. Shorthand for `--format json`.                                                               |
| `--format <format>` | `auto` \| `json` \| `text` (default `auto`).                                                                                     |
| `--full`            | Return every field. The default is a compact projection.                                                                         |
| `--fields <paths>`  | Project comma-separated dot-paths. Mutually exclusive with `--full`. On list verbs the paths are relative to each `data[]` item. |
| `--max-bytes <n>`   | Output size cap, default `24576`; `0` disables. On a list, trailing items are dropped and `truncated` is set.                    |

Every `list` verb additionally takes a window:

| Flag           | Description                                                                                |
| -------------- | ------------------------------------------------------------------------------------------ |
| `--limit <n>`  | How many items this call returns. Default: as many as fit the output cap.                  |
| `--offset <n>` | Where the window starts (default `0`). Pass the previous call's `next_offset` to continue. |

### List envelope

List verbs answer with a single envelope:

```json
{
  "returned": 2,
  "offset": 0,
  "limit": 2,
  "total": 42,
  "has_more": true,
  "next_offset": 2,
  "truncated": { "reason": "max_bytes", "bytes": 123456 },
  "data": []
}
```

| Field         | Meaning                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| `data`        | The items in this window.                                                                               |
| `returned`    | How many items are in `data`.                                                                           |
| `offset`      | Where this window starts.                                                                               |
| `limit`       | Present only when you passed `--limit`.                                                                 |
| `total`       | The server's count where the endpoint reports one, otherwise `null`. A display value, not a bound.      |
| `has_more`    | Whether more items remain. This — not `returned` against `total` — is what says to keep going.          |
| `next_offset` | Pass back as `--offset` for the next window; `null` when the walk is over.                              |
| `truncated`   | Present when `--max-bytes` dropped trailing items; `bytes` is what the full answer would have measured. |

When the cap leaves no room for even one item, the list comes back empty with `next_offset: null` — narrow it with `--fields` or raise the cap. A `get` whose single item is over the cap fails instead, with exit `2`.

## Transforms

Read and run transforms (`/api/transform`). Requires Metabase v59 or newer. A transform's definition is a file under `collections/transforms/`.

### `mb transform list`

```sh
mb transform list
mb transform list --json
```

### `mb transform get <id>`

```sh
mb transform get 1 --json
```

### `mb transform dependencies <id>`

List the upstream transforms this transform depends on (the ones that must run before it). The positional id is a transform id.

```sh
mb transform dependencies 1 --json
```

### `mb transform run <id>`

Trigger a manual run. Returns `{message, run_id}` and exits immediately. Pass `--wait` to poll until the run reaches a terminal status (`succeeded`, `failed`, `timeout`, `canceled`); the `final` field on the result holds the polled run state, and the command exits 1 if the final status is anything but `succeeded`. Pass `--sync` to additionally wait until the run's output table is registered and surface its `target_table_id`, so you can build MBQL cards against it — the run registers the table itself, so no separate `db sync-schema` is needed; `--sync` implies `--wait`.

```sh
mb transform run 1
mb transform run 1 --wait --json
mb transform run 1 --sync --json
```

| Flag              | Description                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `--wait`          | Poll until the run reaches a terminal status.                                                                          |
| `--sync`          | After a successful run, wait until the output table is registered and return its `target_table_id` (implies `--wait`). |
| `--timeout <ms>`  | Polling timeout in ms (default 600000). Used with `--wait`.                                                            |
| `--interval <ms>` | Polling interval in ms (default 2000). Used with `--wait`.                                                             |

### `mb transform cancel <id>`

Cancel the currently-running run for a transform. Exits 0 with `{canceled: true, id}` on success; exits 1 with a 404 if the transform has no active run.

```sh
mb transform cancel 1
mb transform cancel 1 --json
```

### `mb transform get-run <run-id>`

Fetch a single run by run id (not transform id). Same compact / `--full` projection convention as `transform get`.

```sh
mb transform get-run 1 --json
```

### `mb transform runs`

List recent transform runs across all transforms, or filter to one. `/api/transform/run` is server-paged: the CLI pulls only as far as the output cap can display, then reports `has_more` / `next_offset` so you can continue.

```sh
mb transform runs
mb transform runs --transform-id 1 --json
mb transform runs --limit 10 --json
```

| Flag                  | Description                              |
| --------------------- | ---------------------------------------- |
| `--transform-id <id>` | Filter to runs of a single transform id. |

Plus the shared output and window flags — see [Output](#output).

## Transform jobs

Read and run transform jobs (`/api/transform-job`). Requires Metabase v59 or newer. A job's definition is a file under `transforms/transform_jobs/`.

### `mb transform-job list`

```sh
mb transform-job list --json
```

### `mb transform-job get <id>`

```sh
mb transform-job get 1 --json
```

### `mb transform-job run <id>`

Trigger a job manually and return immediately. The job runs every transform carrying one of the job's tags, plus those transforms' dependencies.

```sh
mb transform-job run 1
mb transform-job run 1 --force-refresh --json
```

| Flag              | Description                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| `--force-refresh` | Re-run the whole plan, including dependency transforms that are already fresh (skipped by default). |

### `mb transform-job transforms <id>`

List the transforms a job would run, resolved by the job's tags. The positional id is a job id.

```sh
mb transform-job transforms 1 --json
```

## Transform tags

Read transform tags (`/api/transform-tag`). Requires Metabase v59 or newer. Tags group transforms and jobs; a transform or job file names them by id under `tag_ids`. The four built-in tags (`hourly`, `daily`, `weekly`, `monthly`) drive the built-in jobs. There is no get-by-id endpoint — use `list`.

### `mb transform-tag list`

```sh
mb transform-tag list --json
```

## Transform tests

Tests over a transform's SQL (`/api/ee/transform-test`), the one content family the CLI writes because the representation format has no file for it yet. Requires the `transforms-testing` premium feature. A test names a transform, its input tables (each as SQL or as `columns` plus `rows`) and its expectations (`equals` a table of rows, or `empty`); running it executes the transform over the inputs in a scratch schema and checks every expectation. The server validates inputs and expectations against the transform's SQL on create and update and refuses with an HTTP error whose code starts with `transform-test.` (an input the SQL never reads, a column it lacks, an unparseable source).

### `mb transform-test list`

```sh
mb transform-test list --json
mb transform-test list --transform-id 3 --json
```

| Flag                  | Description                       |
| --------------------- | --------------------------------- |
| `--transform-id <id>` | Only the tests of this transform. |

### `mb transform-test get <id>`

```sh
mb transform-test get 5 --json
```

### `mb transform-test create`

```sh
mb transform-test create --file test.json
```

The body is `{ transform_id, name, description?, inputs, expectations }`; `mb transform-test create --help --json | jq .inputSchema` is the validator.

### `mb transform-test update <id>`

```sh
mb transform-test update 5 --body '{"name":"renamed"}'
```

Omitted fields keep their value.

### `mb transform-test delete <id>`

```sh
mb transform-test delete 5 --yes
```

Prompts without `--yes` at a TTY; refuses with exit 2 when there is no TTY and no `--yes`.

### `mb transform-test run <id>`

```sh
mb transform-test run 5 --json
```

Answers `{ status: "passed" | "failed", expectations: [...], tables: {...} }`: every expectation reports what it found (`passed`, `failed` with the row counts, extra and missing rows and cell mismatches, or `error`), and `tables` maps each input to the scratch table it ran on. Exit `0` whether the test passed or failed; a refusal exits `1`.

## Databases

Read warehouse metadata from `/api/database`. The `db` group exposes the full database list, the per-database record with optional table/field hydration, schema and table inspection, and the two manual-sync triggers.

`db` is aliased to `database`.

> **Agent traversal — the hydration ladder:** start with `db get <db-id> --include tables`, the compact table map (id, name, schema, description per table) — one call that fits most databases. Pick the relevant tables, then fetch fields per table with `table fields <table-id>` (bounded: a table has at most a few hundred fields). `--include tables.fields` is the full rollup — small databases only. When output outgrows the `--max-bytes` cap, the error message names the next command down the ladder. On warehouses with hundreds of tables, traverse by schema (`db schemas <db-id>` → `db schema-tables <db-id> <schema>`) or find tables by name (`mb search <term> --models table --db-id <db-id>`).

### `mb db list`

```sh
mb db list
mb db list --json
mb db list --saved --json
mb db list --include tables --json   # every db with its compact table map
```

| Flag                | Description                                                                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--include <which>` | Hydrate related entities. Currently only `tables` is supported (each database is returned with its compact `tables`). To map a single warehouse, prefer `db get <id> --include tables`. |
| `--saved`           | Include the Saved Questions virtual database in the list. The virtual db has id `-1337` and no `engine`.                                                                                |

### `mb db get <id>`

```sh
mb db get 1
mb db get 1 --json
mb db get 1 --include tables --json          # + compact table map (fits most databases)
mb db get 1 --include tables.fields --json   # + every field of every table (small databases only)
```

| Flag                | Description                                                                                                                                                                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--include <which>` | Hydrate related entities. `tables` is the compact table map — the recommended first call for schema discovery. `tables.fields` is the full rollup and fits only small databases; on anything larger, take the map and fetch fields per table with `table fields <table-id>`, or traverse by schema (see above). |

### `mb db schemas <id>`

List the schemas in a database. Schemas with no tables are excluded. Cheap and bounded — this is the right entry point for an agent walking a warehouse.

```sh
mb db schemas 1
mb db schemas 1 --json
```

### `mb db schema-tables <id> <schema>`

List the tables in one schema, sorted by display name. Returns compact projections without fields — pair with `table get --include fields` (or `table fields <id>`) per table you actually need to introspect.

```sh
mb db schema-tables 1 public
mb db schema-tables 1 analytics --json
```

### `mb db sync-schema <id>`

Trigger a manual schema sync (`POST /api/database/:id/sync_schema`). Returns `{ id, status: "ok" }` once the sync has been queued; the actual work happens asynchronously on the server. Pass `--wait` to poll the database until its `initial_sync_status` reports `complete` (a database that has already finished its initial sync returns at once). To wait for a specific newly-materialized transform table to register, prefer `mb transform run <id> --sync`.

```sh
mb db sync-schema 1
mb db sync-schema 1 --wait --json
```

| Flag              | Description                                                 |
| ----------------- | ----------------------------------------------------------- |
| `--wait`          | Poll until `initial_sync_status` reports `complete`.        |
| `--timeout <ms>`  | Polling timeout in ms (default 600000). Used with `--wait`. |
| `--interval <ms>` | Polling interval in ms (default 2000). Used with `--wait`.  |

### `mb db rescan-values <id>`

Trigger a rescan of cached field values (`POST /api/database/:id/rescan_values`). Returns `{ id, status: "ok" }` once the rescan has been queued.

```sh
mb db rescan-values 1
mb db rescan-values 1 --json
```

## Tables

Inspect and edit warehouse tables via `/api/table`. For agent-driven field introspection, `table get --include fields` is the default — it returns the table plus its columns in a single bounded response.

### `mb table list`

Returns every table in the chosen database (or across all databases) as a flat compact list — no fields, no per-table hydration. On a real warehouse with hundreds of tables this is still bounded (kilobytes), but `db schema-tables <db-id> <schema>` is the better starting point when you know the schema.

```sh
mb table list
mb table list --db-id 1 --json
```

| Flag           | Description                         |
| -------------- | ----------------------------------- |
| `--db-id <id>` | Filter tables by their database id. |

### `mb table get <id>`

Returns the basic table record (no fields). Pass `--include fields` to route through `/api/table/:id/query_metadata` so the response carries the table's columns compact-projected as `fields` — this is the default agent path for field introspection (the response also carries FK targets and dimensions under `--full`). Use `mb table fields <id>` if you only want the fields as a list envelope.

```sh
mb table get 42
mb table get 42 --json
mb table get 42 --include fields --json
```

| Flag                | Description                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| `--include <which>` | Hydrate related entities. Currently only `fields` is supported (bundles compact-projected columns). |

### `mb table fields <id>`

List the fields on a table (a thin projection over `query_metadata.fields`). Use this when you want just the field array without the surrounding table metadata. `--values` adds `values` to each field in the window: the raw cached distinct values of a field with a dropdown list (`has_field_values` of `list` or `auto-list`), `null` on any other field.

```sh
mb table fields 42
mb table fields 42 --json
mb table fields 42 --values --json
```

## Fields

Inspect and edit individual columns via `/api/field`.

### `mb field get <id>`

```sh
mb field get 100
mb field get 100 --json
```

### `mb field values <id>`

Fetch the cached distinct values list (`GET /api/field/:id/values`). Returns the FieldValues envelope (`{ values, field_id, has_more_values }`); empty `values` on fields whose `has_field_values` is `none` or `search`.

```sh
mb field values 100 --json
```

### `mb field summary <id>`

Row count and distinct count for the field (`GET /api/field/:id/summary`). Metabase returns this as an array-of-pairs; the CLI normalizes it to `{ field_id, count, distincts }`.

```sh
mb field summary 100
mb field summary 100 --json
```

## Database metadata on disk

### `mb metadata extract`

```sh
mb metadata extract
mb metadata extract --out .metadata --databases 'Sample Database' --json
```

| Flag                  | Description                                                               |
| --------------------- | ------------------------------------------------------------------------- |
| `--out <dir>`         | Output directory (default `.metadata`).                                   |
| `--databases <names>` | Only these databases, by name, comma separated (default: every database). |

Downloads the connected Metabase's databases, tables and fields (`POST /api/ee/serialization/metadata/export`, streamed) to `<out>/table_metadata.json`, then writes one YAML file per database and one per table with its fields inline under `<out>/databases/`, in the [database-metadata format](https://github.com/metabase/database-metadata): numeric ids are replaced by natural keys (`[database, schema, table, field]`), so the tree is readable and diffable. The `databases/` subtree is replaced on every run. Prints the counts and the output path; `--json` gives `{ databases, tables, fields, out, export_file }`.

The endpoint exists on Metabase v60 through v63 with the `serialization` premium feature; on a later server the command refuses before any request, naming that range.

## Cards

CRUD plus query execution on `/api/card`. A "card" is a Metabase question, model, or metric. The `query` subcommand runs the card and either returns Metabase's JSON envelope or streams a raw CSV / XLSX export.

### `mb card list`

```sh
mb card list
mb card list --filter archived --json
mb card list --filter using_model --model-id 42 --json
```

| Flag                | Description                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `--filter <preset>` | One of `all` (default), `mine`, `bookmarked`, `database`, `table`, `archived`, `using_model`, `using_segment`. |
| `--model-id <id>`   | Required when `--filter` is `database`, `table`, `using_model`, or `using_segment`.                            |

### `mb card get <id>`

```sh
mb card get 1
mb card get 1 --json --full
```

### `mb card query <id>`

Run the card's query. Without `--export-format`, returns the Metabase JSON envelope (`status`, `row_count`, `data: { rows, cols }`, …). With `--export-format csv`, `--export-format json`, or `--export-format xlsx`, the export bytes stream straight to stdout.

```sh
mb card query 1 --json
mb card query 1 --json --limit 20
mb card query 1 --export-format csv > export.csv
mb card query 1 --export-format json > export.json
mb card query 1 --export-format xlsx > export.xlsx
mb card query 1 --parameters '[{"type":"category","value":"A","target":["variable",["template-tag","c"]]}]'
```

| Flag                    | Description                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `--export-format <fmt>` | Stream the export instead of the JSON envelope. One of `csv`, `json`, `xlsx`.                          |
| `--parameters <json>`   | JSON array of Metabase parameter objects (the same shape Metabase POSTs from a dashboard).             |
| `--limit <n>`           | Cap rows kept in the JSON envelope. No effect on streamed exports.                                     |
| `--format-rows`         | Streamed exports only: apply the card's visualization-settings formatting to values (default `false`). |
| `--pivot-results`       | Streamed exports only: emit the pivoted output for pivot questions (default `false`).                  |

## Dashboards

Read and write dashboards on `/api/dashboard`. A dashboard groups cards (questions, models, metrics) into a single layout. Each card on a dashboard is a "dashcard" — a placement record with its own id, position (`row`/`col`), and size (`size_x`/`size_y`). Dashcards live nested inside the parent dashboard's `dashcards` array; the API has no per-dashcard endpoint, so single-dashcard edits round-trip through `PUT /api/dashboard/:id`.

### `mb dashboard list`

```sh
mb dashboard list
mb dashboard list --json
mb dashboard list --filter archived --json
```

| Flag                | Description                                 |
| ------------------- | ------------------------------------------- |
| `--filter <preset>` | One of `all` (default), `mine`, `archived`. |

### `mb dashboard get <id>`

```sh
mb dashboard get 1
mb dashboard get 1 --json
mb dashboard get 1 --json --full
```

`--full` returns the full hydrated dashboard including the `dashcards` and `tabs` arrays. The default compact view returns only `id`, `name`, `description`, `archived`, and `collection_id`.

### `mb dashboard cards <id>`

List the dashcards on a dashboard.

```sh
mb dashboard cards 1
mb dashboard cards 1 --json
```

### `mb dashboard parameter-values <dashboard-id> <parameter-id>`

Fetch the selectable values for one dashboard parameter (`{values, has_more_values}`). Values come from the parameter's static list, its source card, or — for a parameter mapped to a field — the field's live distinct values (chain-filtered).

```sh
mb dashboard parameter-values 1 order_status --json
mb dashboard parameter-values 1 order_status --query Cam --json
```

| Flag               | Description                                                                            |
| ------------------ | -------------------------------------------------------------------------------------- |
| `--query <substr>` | Case-insensitive substring search (first 1000 matches) instead of the full value list. |

## Snippets

Read native query snippets (`/api/native-query-snippet`). A snippet is a named, reusable piece of native (SQL) query text — referenced from cards via `{{snippet: Name}}`. The list endpoint returns either active or archived rows (mutually exclusive — pass `--archived` to swap).

### `mb snippet list`

```sh
mb snippet list
mb snippet list --json
mb snippet list --archived --json
```

| Flag         | Description                                    |
| ------------ | ---------------------------------------------- |
| `--archived` | Show archived snippets instead of active ones. |

### `mb snippet get <id>`

```sh
mb snippet get 1
mb snippet get 1 --json --full
```

## Segments

CRUD on `/api/segment`. A segment is a saved MBQL filter macro tied to a table — used in card filters to share a reusable predicate. Mutating endpoints require a `revision_message` for the audit log.

### `mb segment list`

```sh
mb segment list
mb segment list --json
```

### `mb segment get <id>`

```sh
mb segment get 1
mb segment get 1 --json --full
```

## Measures

CRUD on `/api/measure`. Requires Metabase v59 or newer. A measure is a saved MBQL aggregation (a single `:aggregation` clause) tied to a table — referenced from cards and metrics to share a reusable computation. Mutating endpoints require a `revision_message` for the audit log.

### `mb measure list`

```sh
mb measure list
mb measure list --json
```

### `mb measure get <id>`

```sh
mb measure get 1
mb measure get 1 --json --full
```

## Collections

Read collections on `/api/collection`. Collections are the folders that contain cards, dashboards, and other collections. The list endpoint surfaces a virtual root collection (id `"root"`) alongside regular numeric ids; the get endpoint accepts only the numeric id.

### `mb collection list`

```sh
mb collection list
mb collection list --json
mb collection list --filter archived --json
```

| Flag                | Description                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| `--filter <preset>` | One of `all` (default), `archived` (returns the trash collection only), `personal` (only personal collections). |

### `mb collection get <id>`

`<id>` accepts any of: a positive integer collection id, the literal `root` (the virtual "Our analytics" root), the literal `trash` (the trash collection), or a 21-character entity id (NanoID). Anything else is rejected with a `ConfigError` before any HTTP call.

```sh
mb collection get 4
mb collection get root --json
mb collection get trash --json
mb collection get voo1If9y8Sld0lXej6xl0 --json
mb collection get 4 --json --full
```

`--full` returns the full hydrated collection including `slug`, `entity_id`, `can_write`, `namespace`, and `personal_owner_id`. The default compact view returns `id`, `name`, `description`, `archived`, `location`, `parent_id`, `type`, `authority_level`, and `is_personal`. The root collection has a stripped-down shape — `archived`, `description`, `location`, `type`, etc. are absent rather than `null`.

### `mb collection items <id>`

List the cards, dashboards, sub-collections, and other content stored inside a collection. `/api/collection/:id/items` is server-paged: the CLI pulls only as far as the output cap can display, then reports `has_more` / `next_offset` so you can continue. `<id>` accepts the same forms as `collection get` — including `root` for top-level content (items there have `collection_id: null`).

```sh
mb collection items 4
mb collection items root --json
mb collection items 4 --models card,dashboard --json
mb collection items 4 --pinned-state is_pinned --json
```

| Flag                     | Description                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `--models <csv>`         | Restrict to one or more models (`card`, `dataset`, `metric`, `dashboard`, `snippet`, `collection`, `document`, …). |
| `--archived`             | Return archived items instead of unarchived.                                                                       |
| `--pinned-state <state>` | One of `all`, `is_pinned`, `is_not_pinned`.                                                                        |

Plus the shared output and window flags — see [Output](#output).

### `mb collection tree`

Fetch the full collection hierarchy as a nested tree. Output is always JSON — the recursive structure does not render meaningfully as a key/value table.

```sh
mb collection tree
mb collection tree --json
```

## Library

Curate the Metabase **Library** — a governed subtree (`library-data` "Data" for published tables, `library-metrics` "Metrics" for official metrics, under a `library` root). Tables published to Data appear first when people pick a data source and rank up in search, steering everyone toward trusted, analysis-ready tables. Requires Metabase v59 or newer, the `library` premium feature (Pro/Enterprise), and admin or data-analyst permission (Curate alone won't publish tables). Publish status surfaces on the table via `is_published` (`table get`/`table list`).

### `mb library get`

Show the Library and its Data/Metrics collection ids (`GET /api/ee/library/`). Errors if the Library hasn't been created yet.

```sh
mb library get
mb library get --json
```

### `mb library publish`

Publish tables (and their upstream dependencies) into the Library's Data collection (`POST /api/ee/data-studio/table/publish-tables`). The target Data collection is resolved automatically and the Library is created if it doesn't exist yet — there's no collection id to pass. Publishing does not add the Data collection to the remote-sync scope; on an instance with remote sync configured, the command warns on stderr naming the Data collection an admin adds to the synced collections so exports carry the published tables' metadata.

```sh
mb library publish --table-ids 1,2,3
mb library publish --db-ids 1 --json
mb library publish --schemas 1:public,1:analytics
```

| Flag                | Description                                                       |
| ------------------- | ----------------------------------------------------------------- |
| `--table-ids <ids>` | Comma-separated table ids.                                        |
| `--db-ids <ids>`    | Comma-separated database ids.                                     |
| `--schemas <ids>`   | Comma-separated schema ids, each `<db-id>:<schema>` (`1:public`). |

### `mb library unpublish`

Unpublish tables (and their downstream dependents) from the Library (`POST /api/ee/data-studio/table/unpublish-tables`). Same selector flags as `publish`.

```sh
mb library unpublish --table-ids 1,2,3
mb library unpublish --db-ids 1 --json
```

## Documents

CRUD on `/api/document`. A document is a rich-text page that mixes prose with embedded saved questions (`cardEmbed`) and inline links to Metabase entities (`smartLink`). The body is a [TipTap](https://tiptap.dev/) (ProseMirror) JSON tree stored under `content_type: application/json+vnd.prose-mirror`. The agent-facing format reference lives in the bundled `document` skill (`mb skills get document`). It's a baseline OSS feature — no elevated server version or premium token required.

### `mb document list`

Returns non-archived documents visible to you. The compact item omits the (potentially large) `document` body — pull it with `get --full`.

```sh
mb document list
mb document list --json
```

### `mb document get <id>`

```sh
mb document get 1
mb document get 1 --json --full
```

## Content files

### `mb validate [path…]`

```sh
mb validate
mb validate collections/main/orders.yaml
mb validate collections transforms --json
```

Checks every `*.yaml` under the paths given, or with no path under `collections/`, `databases/`, `transforms/` and `python_libraries/` in the current directory, against the representation schemas vendored under `packages/cli/src/core/schema/data/schemas/` (`bun run sync:representations` refreshes them from `@metabase/representations`). The schema is picked by the file's last `serdes/meta` entry (`model: Card`, `Collection`, `Dashboard`, `Document`, `Measure`, `Segment`, `NativeQuerySnippet`, `Transform`, `TransformJob`, `TransformTag`, `PythonLibrary`, …); a file without `serdes/meta`, with a model no schema covers, or that is not YAML fails with that as its error. Text mode prints `ok <file>` or `error <file>` followed by one `<json-pointer>: <message>` line per error and a closing count; `--json` prints `{ ok, checked, passed, failed, results: [{ file, model, ok, errors: [{ path, message }] }] }`.

Validation is structural: a file that passes can still name a table, card or collection the instance does not have, or a query it cannot run; the import and a run are what prove those. Exit `0` when every file passes, `1` when any file fails (the report is still printed), `2` for a path that does not exist or is neither a file nor a directory.

## Search

### `mb search [query]`

Search Metabase content (cards, dashboards, collections, tables, …). Returns a `ListEnvelope` of compact search results by default; pass `--full` for the full per-row payload.

```sh
mb search orders
mb search --models card,dashboard --limit 10 --json
mb search products --archived
```

| Flag             | Description                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--models`, `-m` | Comma-separated model filter: `card,dataset,metric,dashboard,collection,database,table,segment,measure,document,action,transform,indexed-entity`. |
| `--archived`     | Include archived items only.                                                                                                                      |
| `--limit`        | Max results to return (default `20` — `search` is the one list verb with its own default).                                                        |
| `--offset`       | Where the window starts, applied by the server (default `0`).                                                                                     |
| `--db-id`        | Restrict to items on a given database id.                                                                                                         |
| `--verified`     | Only verified content.                                                                                                                            |

## Git Sync

Drive Metabase Enterprise Remote Sync (`/api/ee/remote-sync`) — import / export Metabase content against a configured git remote, inspect dirty state, and manage branches. All git-sync commands require Metabase v60 or newer, the `remote_sync` premium feature on an active EE token, and superuser credentials.

### `mb git-sync status`

Roll up the current sync state in one call: configured branch, dirty flag, the most recent sync task (or `null` if none has ever run), and the collections marked for sync.

```sh
mb git-sync status
mb git-sync status --json
```

### `mb git-sync tree`

Everything under remote sync in one answer: every synced collection, flat, with its `entity_id`, its `parent_id` (set only when the parent is synced too, `null` for a synced root), and the items directly inside it, each with its `id`, `entity_id`, `name` and `model`. Questions saved to a dashboard are listed in the dashboard's collection. Child collections are not repeated as items, and published tables, which the repository identifies by database path, are left out. The text view prints the hierarchy as an outline.

```sh
mb git-sync tree
mb git-sync tree --json
```

### `mb git-sync is-dirty`

Boolean check for whether any synced collection has unsynced local changes.

```sh
mb git-sync is-dirty --json
```

### `mb git-sync has-remote-changes`

Compare the latest version on the remote branch against the version Metabase last imported. Cached for a short TTL server-side; pass `--force-refresh` to bypass.

```sh
mb git-sync has-remote-changes
mb git-sync has-remote-changes --force-refresh --json
```

| Flag              | Description                                         |
| ----------------- | --------------------------------------------------- |
| `--force-refresh` | Bypass the in-memory cache and re-check the remote. |

### `mb git-sync dirty`

List every object that has unsynced local changes (compact list envelope; `--full` for the per-row payload).

```sh
mb git-sync dirty
mb git-sync dirty --json
```

### `mb git-sync current-task`

Fetch the most recent sync task. Renders `{ status: "idle" }` when no task has ever run, otherwise the full task with its hydrated `status`.

```sh
mb git-sync current-task
mb git-sync current-task --json
```

### `mb git-sync cancel-task`

Cancel the currently running sync task. Fails with HTTP 400 if no task is running.

```sh
mb git-sync cancel-task --json
```

### `mb git-sync wait`

Poll `/current-task` until it reaches a terminal status (`successful`, `errored`, `cancelled`, `timed-out`, `conflict`). Exits 0 on `successful` or `cancelled`; exits 1 on `errored` / `timed-out` / `conflict`. Returns immediately with `{ status: "idle" }` if no task is running.

```sh
mb git-sync wait
mb git-sync wait --timeout 300000 --json
```

| Flag              | Description                             |
| ----------------- | --------------------------------------- |
| `--timeout <ms>`  | Polling timeout in ms (default 600000). |
| `--interval <ms>` | Polling interval in ms (default 2000).  |

### `mb git-sync import`

Import content from the configured git remote into Metabase (repo → Metabase). Auto-polls until the resulting task reaches a terminal status; pass `--no-wait` to return immediately after kickoff.

```sh
mb git-sync import
mb git-sync import --branch main --json
mb git-sync import --force --no-wait
```

| Flag                    | Description                                                           |
| ----------------------- | --------------------------------------------------------------------- |
| `--branch <name>`, `-b` | Branch to import from (defaults to the `remote-sync-branch` setting). |
| `--force`               | Discard local Metabase-side dirty changes before importing (LOSSY).   |
| `--wait` / `--no-wait`  | Poll until the task reaches a terminal status (default: wait).        |
| `--timeout <ms>`        | Polling timeout in ms (default 600000). Used with `--wait`.           |
| `--interval <ms>`       | Polling interval in ms (default 2000). Used with `--wait`.            |

### `mb git-sync branches`

List branches available on the configured git remote.

```sh
mb git-sync branches --json
```

### `mb git-sync worktree list`

List the remote-sync worktrees, each a checkout of one branch that a request enters through `MB_WORKTREE_ID`.

```sh
mb git-sync worktree list --json
```

### `mb git-sync worktree ensure`

Answer the worktree for a branch, creating it when the branch has none. Running it twice, or from two callers at once, answers the same worktree. `--json` prints `{"id": <number>, "branch": "<branch>"}`.

```sh
mb git-sync worktree ensure --branch feature/orders --json
```

| Flag                    | Description                                                  |
| ----------------------- | ------------------------------------------------------------ |
| `--branch <name>`, `-b` | Branch the worktree checks out; it must exist on the remote. |

### `mb git-sync worktree delete <id>`

Delete a worktree and every piece of content it checked out. An id no worktree has is an error.

```sh
mb git-sync worktree delete 3 --json
```

## Agent helpers

Endpoints commonly used by agents driving the instance. `card query` and `transform run` are documented in their own sections; the helper below covers entity-id translation.

### `mb eid [eids]`

Translate string entity ids (EIDs) to numeric ids (`POST /api/eid-translation/translate`).

```sh
mb eid --model card abc123XYZ,def456ABC
mb eid --file translate.json
mb eid --body '{"entity_ids":{"card":["abc123XYZ"]}}'
```

Entity ids are NanoIDs that can start with `-`, which the positional `<eids>` form misreads as a flag (shell quoting doesn't help — the leading `-` survives into argv). For an id that may start with `-`, pass it via `--body`, where the id is a JSON string value immune to flag parsing: `mb eid --body '{"entity_ids":{"card":["-abc123XYZ"]}}'`.

| Arg / Flag       | Description                                                                    |
| ---------------- | ------------------------------------------------------------------------------ |
| `<eids>`         | Comma-separated EIDs positional. Used with `--model`.                          |
| `--model <name>` | Entity model for the positional EIDs (e.g. `card`, `dashboard`, `collection`). |
| `--body <json>`  | Inline JSON body.                                                              |
| `--file <path>`  | Path to JSON body file.                                                        |

## Query

### `mb query`

Run an MBQL 5 query with built-in schema validation. Three modes — discover the schema (`--print-schema`), validate without sending (`--dry-run`), run.

MBQL 5 bodies use numeric IDs (`database: 1`, `source-table: 7`) and POST to `/api/dataset`. The bundled query schema is synced from `@metabase/representations`; `id.yaml` is overridden to require positive integers for every ID `$def`.

```sh
mb query --print-schema                     # JSON Schema bundle
cat q.json | mb query --dry-run             # validate, no network
mb query --file q.json
mb query --file q.json --skip-validate      # bypass pre-flight; let server reject
```

Body sources: `--file`, `--body`, or stdin (exactly one). Body is JSON.

Any non-MBQL 5 body skips pre-flight automatically — legacy MBQL 4 (`{ "type": "query", "database": N, "query": { "source-table": T, ... } }`), legacy native (`{ "type": "native", "database": N, "native": { "query": "..." } }`), or any other shape that doesn't carry `"lib/type": "mbql/query"`. The bundled schema only models MBQL 5; `/api/dataset` normalizes the rest server-side via `lib-be/normalize-query` (the same normalizer that backs saved cards and transforms), so behavior is symmetric across endpoints. `--dry-run` on a non-MBQL 5 body emits `{ ok: true, errors: [] }` (no schema applies). The double-wrap footgun — an MBQL 5 query nested inside a `{type:"query", query:…}` envelope — is still rejected with a `ConfigError` before send.

`--skip-validate` is an escape hatch when the bundled schema disagrees with what the server actually accepts (drift, false negative, edge case) for MBQL 5 bodies. Validation is skipped entirely and the body is sent as-is. Mutually exclusive with `--dry-run` (which is itself the validation mode).

Exit codes:

- `0` — valid (and the query ran successfully when not in dry-run).
- `2` — validation failed, malformed body, or `ConfigError`.
- `1` — server-side error after a valid pre-flight (network, HTTP 4xx/5xx).

Output by mode:

- `--print-schema` — `{ schema, defs: { "id.yaml", "parameter.yaml", "ref.yaml", "temporal_bucketing.yaml" } }`. The query schema's `$ref`s point into the `defs` namespace by file path; an agent can either feed the bundle directly into Ajv (`addSchema(defs["id.yaml"], "id.yaml")` etc., then `compile(schema)`) or read it as documentation.
- `--dry-run` — `{ ok: boolean, errors: { path: string, message: string }[] }`. `path` is a JSON Pointer into the body, `message` is the Ajv error string.
- Run failure (no `--dry-run`) — same `{ ok, errors }` envelope on stdout, exit 2, no request made.
- Run success — the streamed `CardQueryResult`.

## UUIDs

### `mb uuid`

Mint UUID v4 strings (Node `crypto.randomUUID`) for MBQL clause `lib/uuid` slots, native template-tag ids, and any other Metabase-side identifier whose schema enforces RFC 4122 format. Agents must call this command to obtain UUIDs rather than authoring them by hand: the bundled MBQL 5 schema rejects placeholder strings (`a1`, `uuid-1`, etc.) at `format: "uuid"` validation.

```sh
mb uuid                          # one UUID
mb uuid --count 5                # five UUIDs, one per line (text mode in a TTY, JSON when piped)
mb uuid --count 5 --json         # explicit JSON: ["…", "…", "…", "…", "…"]
mb uuid --count 5 --format text  # explicit text: one UUID per line
```

Output: text mode prints one UUID per line; JSON mode prints a `string[]`. Default behavior follows the standard `--format auto` rule — JSON when stdout is a pipe, text when it's a TTY.

`--count` accepts integers `1` through `10000`; outside that range exits 2 with a `ConfigError`.

Exit codes: `0` success, `2` invalid `--count`.

## Skills

The CLI ships with bundled agent skills (Claude Code / `npx skills add` compatible) that document `mb` itself. Content is served at runtime from the installed CLI version, so the instructions an agent fetches always match the binary it's about to run — no drift between a separately-installed skill copy and the CLI.

```sh
mb skills list                              # bundled skills the connected server can use (table or JSON)
mb skills list --unfiltered                 # every bundled skill, whatever the server
mb skills get core                          # print the top-level guide, sections the server cannot use left out
mb skills get core --full                   # include references and templates
mb skills get git-sync,transform            # comma-separated, multi-skill fetch
mb skills get transform --unfiltered        # print a skill as written, even one the server cannot use
mb skills get --all --json --max-bytes 0    # every non-hidden skill the server can use, structured (default cap truncates)
mb skills path                              # absolute paths for direct Read
mb skills path core                         # one path
```

`mb skills get` honors the shared `--max-bytes` list cap. With the default 24 576 cap, `--all` will return only the first skill and emit a truncation notice — pass `--max-bytes 0` to dump every skill in one envelope.

Skills describe the newest Metabase plainly and declare what they rely on: a skill's frontmatter carries `requires: [<feature>, …]` (names from the client's feature table, e.g. `transforms`, `remoteSync`), and a passage inside a skill or one of its references sits between `<!-- requires: <feature>, … -->` and `<!-- /requires -->` markers, each on its own line. `skills list` and `skills get` resolve the connected server through the credential in the environment (the cached probe, or one probe stored for the processes that follow) and resolve both against it: a skill whose features the server lacks is left out and reported in the JSON envelope's `unavailable` array as `{ name, failure }`, where `failure` is the same `{ reason, detail, feature, since, tokenFeature, serverVersion }` a refused command carries; a met section keeps its text and loses its markers; an unmet one is removed. Text mode reports each skipped skill on stderr. Without a server nothing is filtered, `unavailable` is `null`, the markers are printed as written, and text mode says why on stderr: no credential in the environment, or a server that could not be probed. `--unfiltered` bypasses the filter on both commands and prints the selected skills as written; on `get`, `--all` selects every non-hidden skill and combines with either. A marker inside a fenced code block is text. An unknown feature name, an unbalanced marker pair, or a marker between table rows is a `ConfigError` on every read, so a typo fails the gate rather than hiding a skill.

Bundled skills:

| Name                             | Use                                                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `core`                           | Entry point: the file-then-sync loop, flag and output conventions, every command group               |
| `rde`                            | The data-engineering method: raw tables to clean tables, definitions, dashboards and checked answers |
| `metabase-representation-format` | The content file schemas and folder layout, with the full spec                                       |
| `metabase-database-metadata`     | Reading the `.metadata/databases/` tree `metadata extract` writes                                    |
| `mbql`                           | MBQL queries in `mb query` and in files, and moving between the two forms                            |
| `native-sql`                     | Native SQL queries: template tags, field filters, snippets, card references                          |
| `visualization`                  | Choosing a card's `display` and authoring `visualization_settings`                                   |
| `dashboard`                      | Dashboard files: grid layout, filter wiring, linked filters, cross-filtering, click behavior         |
| `metadata`                       | Table and field metadata, where it lives, and the features each setting unlocks                      |
| `transform`                      | Transform files, runs, transform tests, tags and jobs                                                |
| `document`                       | Document files: the ProseMirror body, embedded cards, entity links                                   |
| `git-sync`                       | Putting a branch into Metabase, sync state, and the tracked-branch guard                             |

Exit codes: `0` success (a skill the server cannot use is reported, not refused), `2` `ConfigError` (missing name, unknown name, `MB_SKILLS_DIR` not a directory, an unknown feature in `requires`, an unbalanced section marker), `1` unexpected I/O.

## Environment variables

Every `MB_` name is a constant in `packages/cli/src/core/env.ts`.

| Variable                | Effect                                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MB_URL`                | The Metabase URL.                                                                                                                                                         |
| `MB_API_KEY`            | The API key, when no broker is set.                                                                                                                                       |
| `MB_AUTH_BROKER`        | The desktop app's credential broker (`http://127.0.0.1:<port>`); set together with `MB_AUTH_BROKER_TOKEN`.                                                                |
| `MB_AUTH_BROKER_TOKEN`  | The session's bearer token for the broker.                                                                                                                                |
| `MB_WORKTREE_ID`        | A remote-sync worktree id (a positive integer). Every request carries it as `X-Metabase-Worktree-Id`, so every command acts inside that worktree; unset is the main app.  |
| `MB_VERBOSE`            | When set to `1`, prints structured developer-detail JSON to stderr on failure.                                                                                            |
| `MB_CLI_SKIP_PREFLIGHT` | When set to `1`, bypasses the per-command server version / token-feature preflight check. Escape hatch for patched Metabase builds; can mask real compatibility problems. |
| `MB_SKILLS_DIR`         | Override the directory `mb skills` scans (the app points it at the bundled `skill-data`; defaults to the CLI's own `skill-data` tree).                                    |

## Agent integration

### `--help --json`

Every node of the command tree answers `--help --json` with machine-readable help, mirroring what text help shows at that level:

- A leaf command emits its full entry — name, description, `details`, examples, citty args with types/defaults/enums, `requires` (the client methods the command calls and the server features they need), and the input and output Zod schemas rendered as JSON Schema (`inputSchema` is the exact validator `readBody` enforces on the JSON body, `null` for commands that take none).
- A command group (and the root) emits `{ description, skills, commands }` — its own sentence (`null` when it declares none), its own agent-skill pointers, and a flat `commands: [{ command, description }]` index of every leaf in its subtree, with full-path names.

```sh
mb --help --json | jq -r '.commands[].command'    # every command
mb card query --help --json | jq .outputSchema    # one command's output schema
mb query --help --json | jq .inputSchema          # the JSON-body contract it validates
```

The entry and index schemas (`CommandHelpEntry`, `CommandHelpIndex`) are exported from `packages/cli/src/runtime/command-help.ts`.

## Exit codes

| Code  | Meaning                                                |
| ----- | ------------------------------------------------------ |
| `0`   | Success.                                               |
| `1`   | Verification or operation failed.                      |
| `2`   | Configuration error (invalid flag, missing TTY, etc.). |
| `130` | Interactive prompt cancelled (Ctrl+C).                 |

## Working in the repo

```sh
bun install
bun run check          # the full gate: typecheck, lint, format, unit tests, skill lint
bun run build
bun run test           # unit tests
bun run typecheck
bun run lint
```

The e2e tier drives the built binary against a real Metabase in docker compose:

```sh
bun run e2e:up
bun run e2e:bootstrap
bun run test:e2e
```

`bun run e2e:down` wipes the stack's volumes, and is the routine way back to a
known-good stack: the app-db lives in a docker volume while `bun run e2e:bootstrap`
writes its record of the seed into the working tree, so a fresh worktree or a
`git clean -x` leaves a seeded server the bootstrap can no longer recognise. It
refuses to re-seed one and names this command. `bun run e2e:matrix` runs the suite
across the supported version/edition matrix.

`docs/architecture.md` explains how the repo is laid out and why; `CLAUDE.md` carries the
binding rules.
