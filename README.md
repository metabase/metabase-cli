# metabase-cli

Command-line client for Metabase. Logs in to an instance in your browser (OAuth, Metabase v63+) or with an API key, and stores credentials securely on your machine.

## Supported Metabase versions

The CLI is built against Metabase majors **58 through 64** (the client's `KNOWN_RANGE`), the latest patch of each; a newer release runs as the major after the newest known one, with one stderr notice per run; a development build (master or a local build, reporting a tag such as `vUNKNOWN`) is treated as newer than every release, with every version-gated command available and no notice; and an older one keeps its real major, gets one stderr notice per run pointing at a Metabase upgrade, and is refused command by command with the version it needs.

Every command declares the client methods it calls, and each method names the server features it needs — a feature is a minimum major version, a premium token feature, or both. The server version and token features are detected and cached when you run `mb auth login` (or `mb auth list`). For a command whose methods need a feature, a preflight check runs before the first request and refuses with an actionable message (exit code `2`) when:

- the server is older than the command's minimum version, or
- the command needs a premium feature (e.g. `remote_sync`, `content_translation`, `library`) that isn't enabled.

Plain OSS commands against a v0.58+ server (the majority) carry no elevated requirement and skip the preflight entirely. When a gated command runs without a cached probe, the CLI asks the server for its version once and decides on the answer; a server that cannot be reached fails the command with that network error. To bypass the check for a single run, pass `--skip-preflight`; to bypass it process-wide (e.g. in CI), set `MB_CLI_SKIP_PREFLIGHT=1`. Both switch off the client's own check too, so every request goes to the wire and the server answers for itself — footguns, only for servers you know are patched.

`mb auth status --json` reports the window as `knownRange` and where the server sits as `skew`. A release above the window is read as the major after the newest known one: its additions pass through, and one stderr notice per run points at `mb upgrade`. A development build is `development`, ahead of every release, and prints no notice; a server below the window is `older-than-known`, still evaluated at its own major, with a notice naming the oldest major the CLI supports. A response the CLI cannot parse, or a refusal it issues, under a cached profile triggers one fresh probe: if the server's version or premium features changed since the cache was written, the profile is refreshed and the error says so — retry the command.

## Install

```sh
npm install -g @metabase/cli
mb --help
```

Or build from source:

```sh
bun install
bun run build
node packages/cli/dist/cli.mjs --help
```

The binary is `mb`. Examples below use that name.

File paths in this document are relative to the repository root, so they resolve in a checkout of <https://github.com/metabase/mb-cli> rather than in the installed package — the npm tarball carries only `dist`, `skills` and `skill-data`.

## Quick start

```sh
mb auth login --url https://metabase.example.com
mb auth status
```

## Output

Every `list` and `get` verb takes the same output flags. The per-command flag tables below list only what is specific to that command.

| Flag                | Description                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `--json`            | Emit JSON. Auto-enabled on non-TTY. Shorthand for `--format json`.                                                               |
| `--format <format>` | `auto` \| `json` \| `text` (default `auto`).                                                                                     |
| `--full`            | Return every field. The default is a compact projection.                                                                         |
| `--fields <paths>`  | Project comma-separated dot-paths. Mutually exclusive with `--full`. On list verbs the paths are relative to each `data[]` item. |
| `--max-bytes <n>`   | Output size cap, default `24576`; `0` disables. On a list, trailing items are dropped and `truncated` is set.                    |
| `-p, --profile <n>` | Named profile (default `default`).                                                                                               |

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

## Authentication

Credentials are stored per-profile. The default profile is named `default`. Use `--profile <name>` to manage additional profiles.

### `mb auth login`

Log in to a Metabase instance and save the credential to a profile. Interactive login offers two methods:

- **In your browser** (recommended; requires Metabase v63 or newer) — the CLI opens Metabase, you sign in with your password or SSO and approve the CLI, and a short-lived access token plus a rotating refresh token are stored. Tokens refresh automatically; you never paste a secret.
- **With an API key** — paste a key from Admin settings → Authentication → API keys.

Against a server older than v63 the CLI detects the missing OAuth support and falls back to the API key prompt automatically. Supplying an API key (flag, env, or stdin) always skips the browser flow, so CI and scripts behave exactly as before.

On success the server is probed once — the rendered output shows the user, role (`Admin`/`User`), Metabase version and skew (`--json` adds `edition`, `knownRange` and `features`), and the probe is cached in `<configDir>/profiles.json` so later commands skip re-probing. Failure of either the auth probe (`/api/user/current`) or the server probe (`/api/session/properties`) rejects the login; an existing profile keeps its last-known-good credential and gains a `lastFailure` entry.

| Flag                     | Description                                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `--url <url>`            | Metabase URL, including any subpath if the instance is hosted under one (`https://my.org.com/metabase`). Falls back to `MB_URL`, then prompts. |
| `--api-key <value>`      | API key. Skips the browser flow. Visible in shell history — pipe on stdin instead.                                                             |
| `--client-id <id>`       | Pre-registered OAuth client id (only needed when dynamic client registration is disabled on the server).                                       |
| `--profile <name>`, `-p` | Profile to write to (default: `default`).                                                                                                      |
| `--skip-verify`          | Save without contacting the server (no probe, no cache).                                                                                       |

Non-interactive (non-TTY) login requires an API key; resolution order: `--api-key` → piped stdin → `MB_API_KEY` (first non-empty wins). Without one, non-interactive login fails rather than prompting.

```sh
mb auth login                                            # interactive: browser or API key
echo "$MB_KEY" | mb auth login --url https://m.example.com
mb auth login --url https://m.example.com < key.txt
```

### `mb auth status`

Show whether a profile is authenticated. The output includes the auth method (`OAuth` or `API key`) alongside the cached user, role, server version and skew (`supported`, `older than this CLI supports (vN min)`, `newer than this CLI knows (vN max)`, or `unknown version`). `--json` adds what the CLI derives from the cached probe: `edition`, `skew`, `knownRange` and the `features` map the preflight checks.

```sh
mb auth status
mb auth status --json
mb auth status --profile staging
```

| Flag                     | Description                              |
| ------------------------ | ---------------------------------------- |
| `--profile <name>`, `-p` | Profile to inspect (default: `default`). |
| `--json`                 | Emit JSON. Auto-enabled on non-TTY.      |

### `mb auth list`

List configured authentication profiles. All profile metadata (URL, auth method, last successful probe, last failure) lives in `<configDir>/profiles.json` at mode `0600`; the secrets (API key, or OAuth access/refresh tokens) sit in the OS keychain when available, or inline in the same file when the keychain is unavailable.

`auth list` re-probes every profile, one at a time — a probe can refresh and rewrite an expired OAuth token, so probes are serialized to avoid racing on the shared `profiles.json`. On success it refreshes `lastProbe` (Metabase version, token features, user identity) and clears `lastFailure`; on failure it updates `lastFailure` and leaves the prior `lastProbe`/`url`/credential untouched. Rendered columns: `Profile | URL | Auth | Status | Role | Version | Skew | Last probed`; `--json` rows carry the same derived `edition`, `skew`, `knownRange` and `features` as `auth status`. Failed rows append a one-line footer pointing at `mb auth login --profile <name>`.

```sh
mb auth list
mb auth list --json
```

| Flag     | Description                         |
| -------- | ----------------------------------- |
| `--json` | Emit JSON. Auto-enabled on non-TTY. |

### `mb auth logout`

Clear stored credentials for a profile. For an OAuth profile the refresh token is also revoked server-side, best-effort: local credentials are cleared first and a revocation failure only warns, so a slow or offline server never blocks the logout.

```sh
mb auth logout --yes
mb auth logout --profile staging --yes
```

| Flag                     | Description                                                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `--profile <name>`, `-p` | Profile to clear (default: `default`).                                                                                            |
| `--yes`                  | Skip the interactive confirmation prompt. In non-TTY contexts the prompt is skipped automatically (kubectl/gh/docker convention). |

## Transforms

CRUD on `/api/transform`. Requires Metabase v59 or newer. Bodies for `create` / `update` are JSON; resolution order: `--body` → `--file` → piped stdin (auto-detected when stdin is not a TTY).

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

### `mb transform create`

```sh
cat transform.json | mb transform create
mb transform create --file transform.json
```

| Flag            | Description             |
| --------------- | ----------------------- |
| `--body <json>` | Inline JSON body.       |
| `--file <path>` | Path to JSON body file. |

### `mb transform update <id>`

```sh
mb transform update 1 --body '{"name":"renamed"}'
```

Same `--body` / `--file` resolution as `create`. Stdin is auto-detected when not a TTY.

### `mb transform delete <id>`

```sh
mb transform delete 1 --yes
```

| Flag    | Description                                                                                                                       |
| ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `--yes` | Skip the interactive confirmation prompt. In non-TTY contexts the prompt is skipped automatically (kubectl/gh/docker convention). |

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

CRUD on `/api/transform-job`. Requires Metabase v59 or newer. Bodies for `create` / `update` follow the same `--body` / `--file` / stdin pattern as transforms.

### `mb transform-job list`

```sh
mb transform-job list --json
```

### `mb transform-job get <id>`

```sh
mb transform-job get 1 --json
```

### `mb transform-job create`

```sh
mb transform-job create --body '{"name":"daily","schedule":"0 0 0 * * ?"}'
```

| Flag            | Description             |
| --------------- | ----------------------- |
| `--body <json>` | Inline JSON body.       |
| `--file <path>` | Path to JSON body file. |

### `mb transform-job update <id>`

```sh
mb transform-job update 1 --body '{"schedule":"0 0 6 * * ?"}'
```

### `mb transform-job delete <id>`

```sh
mb transform-job delete 1 --yes
```

| Flag    | Description                                                                                                                       |
| ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `--yes` | Skip the interactive confirmation prompt. In non-TTY contexts the prompt is skipped automatically (kubectl/gh/docker convention). |

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

### `mb transform-job set-active <true|false>`

Activate or deactivate every transform job at once (admin only; requires Metabase v61 or newer). Inactive jobs do not run on schedule; manual runs ignore the flag.

```sh
mb transform-job set-active false
mb transform-job set-active true --json
```

## Transform tags

CRUD on `/api/transform-tag`. Requires Metabase v59 or newer. Tags group transforms and jobs; reference them by id via the `tag_ids` field on a transform or job. The four built-in tags (`hourly`, `daily`, `weekly`, `monthly`) drive the built-in jobs. There is no get-by-id endpoint — use `list`.

### `mb transform-tag list`

```sh
mb transform-tag list --json
```

### `mb transform-tag create`

```sh
mb transform-tag create --body '{"name":"nightly"}'
```

| Flag            | Description             |
| --------------- | ----------------------- |
| `--body <json>` | Inline JSON body.       |
| `--file <path>` | Path to JSON body file. |

### `mb transform-tag update <id>`

```sh
mb transform-tag update 5 --body '{"name":"renamed"}'
```

### `mb transform-tag delete <id>`

```sh
mb transform-tag delete 5 --yes
```

| Flag    | Description                                                                                                                       |
| ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `--yes` | Skip the interactive confirmation prompt. In non-TTY contexts the prompt is skipped automatically (kubectl/gh/docker convention). |

## Transform tests

CRUD and run on `/api/ee/transform-test`. Requires Metabase v65 or newer with the `transforms-testing` premium feature. A transform test pins a transform's behaviour: every table the transform reads is replaced by an `input` fixture, the transform runs into a temp table, and each `expectation` checks that output. The temp tables are dropped when the run ends. The transform and the expectations read only those temp tables; a `format: "sql"` input runs verbatim against the transform's source database, so it may read real tables. Only query transforms (native SQL or MBQL) can be tested, on Postgres, MySQL, H2, ClickHouse, Redshift or SQL Server.

An input names its `table` and carries either `format: "sql"` with a `sql` query or `format: "rows"` with `columns` (each a `name` and a `cast_type` the warehouse accepts as a `CAST` target) and `rows`; every row carries exactly the declared columns.

An expectation is either `type: "empty"` with the `sql` that must return no rows, or `type: "equals"` with `format: "rows"` and the `columns` and `rows` the output must hold exactly. Expectation names are unique within a test. Expectation SQL may name only the transform's target table and its declared input tables, which are rewritten to the run's temp tables; any other table, or a column qualified by a table name rather than an alias, is refused with `transform-test.unremapped-reference`.

Create and update bodies are closed at every level, so a test read back with `get --full` has to shed `id`, `entity_id`, `creator_id`, `created_at` and `updated_at` before it can be sent back:

```sh
mb transform-test get 1 --full --json \
  | jq 'del(.id, .entity_id, .creator_id, .created_at, .updated_at)' \
  | mb transform-test update 1
```

### `mb transform-test list`

```sh
mb transform-test list --json
mb transform-test list --transform 1
```

| Flag               | Description                          |
| ------------------ | ------------------------------------ |
| `--transform <id>` | Only the tests of this transform id. |

### `mb transform-test get <id>`

The compact form carries the id, transform, name and description; `--full` adds the `inputs` and `expectations` themselves.

```sh
mb transform-test get 1
mb transform-test get 1 --full --json
```

### `mb transform-test create`

```sh
mb transform-test create --file transform-test.json
```

| Flag            | Description             |
| --------------- | ----------------------- |
| `--body <json>` | Inline JSON body.       |
| `--file <path>` | Path to JSON body file. |

### `mb transform-test update <id>`

Only the fields the body carries are patched; `inputs` and `expectations` replace what is stored rather than merging into it.

```sh
mb transform-test update 1 --body '{"name":"renamed"}'
```

### `mb transform-test delete <id>`

```sh
mb transform-test delete 1 --yes
```

| Flag    | Description                                                                                                                       |
| ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `--yes` | Skip the interactive confirmation prompt. In non-TTY contexts the prompt is skipped automatically (kubectl/gh/docker convention). |

### `mb transform-test run <id>`

Runs the transform against the fixtures and reports what each expectation found. Exits 1 when the test does not pass, so it drops straight into CI.

```sh
mb transform-test run 1
mb transform-test run 1 --json
mb transform-test run 1 --timeout 300000
```

| Flag             | Description                                                                |
| ---------------- | -------------------------------------------------------------------------- |
| `--timeout <ms>` | Request timeout in ms (default 30000); the run is one synchronous request. |

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

| Flag                | Description                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--include <which>` | Hydrate related entities. Currently only `tables` is supported (each database is returned with its compact `tables`). To map a single warehouse, prefer `db get <id> --include tables`.          |
| `--saved`           | Include the Saved Questions virtual database in the list. The virtual db has id `-1337` and no `engine`, and its `--include tables` are the saved questions, each with a `card__<id>` string id. |

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
mb table list --term order --can-query --json
mb table list --data-layer hidden --orphan-only --json
```

`--db-id` narrows the list on the client; every other flag is applied by the server. A filter the server is too old to honour is refused before any request (exit 2) rather than dropped.

| Flag                          | Description                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `--db-id <id>`                | Filter tables by their database id.                                                                                            |
| `--term <text>`               | Match table names and display names by prefix; `*` is a wildcard (`--term 'order*'`, `--term ite` also matches `Order Items`). |
| `--visibility-type <type>`    | Only tables with this visibility: `hidden`, `technical`, `cruft`.                                                              |
| `--data-layer <layer>`        | Only tables in this data layer: `final`, `internal`, `hidden` (Metabase v58 names them `gold`, `silver`, `bronze`, `copper`).  |
| `--data-source <source>`      | Only tables from this data source: `unknown`, `ingested`, `metabase-transform`, `transform`, `source-data`, `upload`.          |
| `--owner-user-id <id>`        | Only tables owned by this user id.                                                                                             |
| `--owner-email <email>`       | Only tables owned by this email.                                                                                               |
| `--orphan-only`               | Only tables with no owner.                                                                                                     |
| `--unused-only`               | Only tables nothing depends on. Needs the `dependencies` premium feature.                                                      |
| `--published-only`            | Only tables published to the library (Metabase v63+).                                                                          |
| `--can-query`                 | Only tables you can run queries against (Metabase v59+).                                                                       |
| `--can-write`                 | Only tables whose metadata you can edit (Metabase v59+).                                                                       |
| `--include-transform-targets` | Also list the inactive tables a transform writes to, which carry `active: false` (Metabase v60+).                              |

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

List the fields on a table (a thin projection over `query_metadata.fields`). Use this when you want just the field array without the surrounding table metadata.

```sh
mb table fields 42
mb table fields 42 --json
```

### `mb table fks <id>`

List the foreign keys pointing at a table: every active field whose `fk_target_field_id` is an active, unretired field of this one, the table's own self-references included. The server leaves out origin fields in inactive tables and in tables the caller cannot read, so a non-admin sees only the foreign keys from tables it can read. Each row carries the origin field with its table (`id`, `name`, `display_name`, `schema`, `db_id`), the destination field and the relationship (`Mt1`); the text table names the origin as `<schema>.<table>.<field>`, or `<table>.<field>` on a database without schemas. A table nothing points at answers an empty list.

```sh
mb table fks 42
mb table fks 42 --json
```

### `mb table update <id>`

Patch a table (`PUT /api/table/:id`). Body fields: `display_name`, `description`, `caveats`, `points_of_interest`, `entity_type`, `visibility_type`, `field_order`, `show_in_getting_started`. Pass the body via `--body`, `--file`, or stdin (exactly one).

```sh
mb table update 42 --body '{"display_name":"Customers"}'
mb table update 42 --file patch.json
echo '{"description":"Customer dimension"}' | mb table update 42
```

Publish status surfaces on the table itself — `table get`/`table list` carry `is_published` (and `collection_id` under `--full`). Publishing tables to the Library is done with [`mb library publish`](#library).

### `mb table sync-schema <id>`

Trigger a manual sync of one table (`POST /api/table/:id/sync_schema`): it re-reads the table's columns, fingerprints them, and refreshes the table's cached field values. It never discovers new tables; a table the warehouse just gained needs `mb db sync-schema <id>`. Returns `{ id, status: "ok" }` once the sync has been queued; the work happens asynchronously on the server, which reports no completion to wait on. A warehouse the server cannot connect to is refused with a 422. To sync a set of tables use `mb table bulk-sync-schema`.

```sh
mb table sync-schema 42
mb table sync-schema 42 --json
```

### `mb table rescan-values <id>`

Trigger a rescan of one table's cached field values (`POST /api/table/:id/rescan_values`). Only the sets already cached and read in the last 14 days are refreshed; a set never read, discarded, or unread for longer is skipped until a read rebuilds or revives it. Returns `{ id, status: "success" }` once the rescan has been queued.

```sh
mb table rescan-values 42
mb table rescan-values 42 --json
```

### `mb table discard-values <id>`

Discard one table's cached field values (`POST /api/table/:id/discard_values`), and with them any custom display values set on those values. No scan recreates a discarded set, neither `mb table rescan-values` nor the database's scheduled scan; Metabase rebuilds a set, without its display values, the next time it is read (a filter dropdown, `mb field values <id>`). Asks for confirmation on a terminal and refuses without `--yes` when stdin is not a TTY. Returns `{ id, discarded, aborted }`.

```sh
mb table discard-values 42 --yes
mb table discard-values 42
```

### `mb table bulk-edit`

Set the same metadata on every table a selector picks out (`POST /api/data-studio/table/edit`, Metabase v59+). The body selects tables with any of `table_ids`, `database_ids`, and `schema_ids` (each schema id is `"<db-id>:<schema>"`, e.g. `1:public`; the selectors are unioned) and sets any of `data_authority`, `data_source`, `data_layer`, `entity_type`, `owner_email`, `owner_user_id` on all of them. A configured `data_authority` cannot be set back to `unconfigured`, and `data_source` never moves to or from `metabase-transform`. A selected table that breaks either rule fails the call: before Metabase 64 no table is edited, while on 64 the selected tables Metabase held no user edits for may already carry the new values. Before Metabase 64, `null` clears a field, `null` for `data_authority` is refused before any request, and the next scheduled analysis overwrites `entity_type` with the type it derives from the table name. On Metabase 64, `null` withdraws the edit: `data_source` and `data_layer` read back empty, while `entity_type`, `owner_email`, `owner_user_id`, and `data_authority` fall back to the values Metabase keeps for the table, which are the name-derived entity type and the owner and data authority from before the upgrade (no owner and `unconfigured` for a table published then or created since). A body that selects nothing or sets nothing is refused before any request. Pass the body via `--body`, `--file`, or stdin (exactly one). The server answers `{}` whether or not a selector matched a table, so the command returns the accepted request restated, `{ accepted: true, ...body }`, and cannot say which tables were edited. Metabase 58 serves the same edit only on Enterprise, at `/api/ee/data-studio/table/edit` with the medallion layer names; the command does not reach it, because a method's requirements cannot say "58 with the `data-studio` token, or 59 and later", and the medallion names do not map onto the `final` / `internal` / `hidden` layers the body takes.

```sh
mb table bulk-edit --body '{"table_ids":[42,43],"owner_email":"dba@example.com"}'
mb table bulk-edit --body '{"schema_ids":["1:public"],"data_layer":"final"}' --json
cat edit.json | mb table bulk-edit
```

### `mb table bulk-sync-schema` / `bulk-rescan-values` / `bulk-discard-values`

The selector forms of `sync-schema`, `rescan-values`, and `discard-values` (`POST /api/data-studio/table/sync-schema`, `/rescan-values`, `/discard-values`, Metabase v59+). Select tables with `--table-ids`, `--db-ids`, or `--schemas` (comma-separated; each schema id is `"<db-id>:<schema>"` with a positive database id, and `1:` selects the tables of database 1 that have no schema); the selectors are unioned. Only an admin or a data analyst may call them; anyone else gets a 403. `bulk-sync-schema` first tests the connection of every database behind the selection and is refused with a 422 if one fails. `bulk-discard-values` asks for confirmation like `discard-values` and needs `--yes` when stdin is not a TTY. The server answers no body whether or not a selector matched a table, so each command returns the accepted request restated, e.g. `{ accepted: true, schema_ids: ["1:public"] }` (`bulk-discard-values` adds `aborted`).

```sh
mb table bulk-sync-schema --schemas 1:public
mb table bulk-rescan-values --db-ids 1 --json
mb table bulk-discard-values --table-ids 42,43 --yes
```

## Fields

Inspect and edit individual columns via `/api/field`.

### `mb field get <id>`

Get one field (`GET /api/field/:id`). Its `data_sensitivity` is the label `mb field set-sensitivity` sets, or `null` when the field has none; a server older than Metabase v64 has no such label, so the key and the Sensitivity column are left out.

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

### `mb field update <id>`

Patch a field (`PUT /api/field/:id`). Body fields: `display_name`, `description`, `caveats`, `points_of_interest`, `semantic_type`, `coercion_strategy`, `fk_target_field_id`, `visibility_type`, `has_field_values`, `settings`, `nfc_path`, `json_unfolding`. Pass the body via `--body`, `--file`, or stdin.

```sh
mb field update 100 --body '{"description":"customer email","semantic_type":"type/Email"}'
mb field update 100 --file patch.json
```

### `mb field search <id> <search-id>`

Search the values of one field and answer them paired with another field's values (`GET /api/field/:id/search/:search-id`). Each row is `{ value, label }`: a distinct pair of a value of `<id>` and the value of `<search-id>` on the same warehouse row, ordered by value. A FK on either side is followed to the key it points at, so searching an id column by a name column answers id/name pairs; after that both fields must be on one table, and a pair that is not answers no rows rather than an error, as does any failure of the warehouse query. `--value` keeps the rows whose `<search-id>` value contains it, case-insensitively; without it the first `--limit` rows are answered, so one of the two is required. `label` is `null` when `<id>` and `<search-id>` resolve to the same field once FKs are followed. A field with custom display values answers every mapped value instead, with its display value as `label`, matching `--value` against the display value and ignoring `<search-id>`. The endpoint takes no offset and reports no count, so `total` is `null`, every request asks for the rows from the first, at most 1000 at first and twice as many on each request after until the window is covered, and `has_more` is proven by one row fetched past it.

```sh
mb field search 100 101 --value ada
mb field search 100 101 --value ada --limit 5 --json
mb field search 100 101 --limit 20 --json
```

| Flag             | Description                                               |
| ---------------- | --------------------------------------------------------- |
| `--value <text>` | Text the searched values must contain (case-insensitive). |
| `--limit <n>`    | Max rows to return; required when `--value` is absent.    |
| `--offset <n>`   | Start at this row index; pass the previous `next_offset`. |

### `mb field remapping <id> <remapped-id> <value>`

Look up another field's value on the one row where a field equals a value (`GET /api/field/:id/remapping/:remapped-id`). Answers `{ found: true, value, label }` with `label` the value of `<remapped-id>`, or `{ found: false }` when no row matches. A FK `<id>` is followed to the key it points at, and `<remapped-id>` must be on that key's table: the server answers a pair that is not, and any failure of the warehouse query, as `{ found: false }` rather than an error. When `<id>` is numeric the server reads the leading number of `<value>` and ignores any text after it (`20abc` looks up 20), failing only a value with no leading number; a value starting with `-` goes after `--` (`mb field remapping 100 101 -- -5`). In text mode the label prints bare, so `NAME=$(mb field remapping 100 101 20 --format text)` composes; an empty line means either no row matched or the matched label is empty, which `--json` tells apart.

```sh
mb field remapping 100 101 20
mb field remapping 100 101 20 --json
```

### `mb field set-sensitivity <id> <label|none>`

Label a field's data sensitivity by hand (`PUT /api/field/:id` with `data_sensitivity`). A label set here is a person's call that the server's classifier never overwrites; `none` withdraws it, and the field then shows the label the classifier wrote, if it wrote one (the classifier is off unless the server enables it, and a label it wrote stays after it is switched off), else none. Labels, most severe first: `SEC_KEY`, `SYS_TELEMETRY`, `PHI`, `BIO_GEN`, `PCI_FIN`, `SENS_PERS`, `PII`, `CORP_IP`, `BIZ_CONF`, `PUBLIC`. Answers the field with its `data_sensitivity`; `mb field get <id>` reads it back. Requires Metabase v64 or newer.

```sh
mb field set-sensitivity 100 PII
mb field set-sensitivity 100 none
mb field set-sensitivity 100 PHI --json
```

## Upload

Load CSV/TSV data into the warehouse via `/api/upload`. Requires an uploads database configured on the server (Admin → Settings → Uploads); the destination db and schema are set there, not per-command. `append`/`replace` target a table created by a prior upload, and the CSV columns must match.

### `mb upload csv`

Create a new table plus a model over it from a CSV file. Prints the new model id and table id.

```sh
mb upload csv --file data.csv
mb upload csv --file data.csv --collection 5
mb upload csv --file data.csv --json
```

| Flag                | Description                                                            |
| ------------------- | ---------------------------------------------------------------------- |
| `--file <path>`     | Path to the CSV/TSV file to upload (required).                         |
| `--collection <id>` | Target collection id for the created model, or `root` (default: root). |

### `mb upload append <table-id>`

Insert a CSV file's rows into an existing uploaded table.

```sh
mb upload append 42 --file more-rows.csv
mb upload append 42 --file more-rows.csv --json
```

### `mb upload replace <table-id>`

Replace an existing uploaded table's contents with a CSV file's rows.

```sh
mb upload replace 42 --file rows.csv
mb upload replace 42 --file rows.csv --json
```

## Content translation

Download and replace Metabase's content translation dictionary through `/api/ee/content-translation`. These commands require an admin credential and the `content_translation` premium feature. The dictionary is independent of Remote Sync: importing or exporting a Git repository does not deploy it.

### `mb content-translation download`

Stream the complete active dictionary as CSV. Redirect stdout to keep it as a file. An empty dictionary downloads as Metabase's four-row sample, not a header-only file.

```sh
mb content-translation download > metabase-content-translations.csv
mb content-translation download --profile prod > translations.csv
```

### `mb content-translation upload`

Replace every active content translation with one complete CSV. The upload is not a partial merge; keep the canonical complete dictionary in version control and download the active dictionary before replacing it. Metabase accepts dictionaries up to 1.5 MiB.

```sh
mb content-translation upload --file translations.csv
mb content-translation upload --file translations.csv --profile prod --json
```

| Flag            | Description                                             |
| --------------- | ------------------------------------------------------- |
| `--file <path>` | Complete content translation dictionary CSV (required). |

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

Run the card's query. Without `--export-format`, returns the Metabase JSON envelope (`status`, `row_count`, `data: { rows, cols }`, …). With `--export-format csv`, `--export-format json`, or `--export-format xlsx`, the export bytes stream straight to stdout, capped at the server's download row limit. An export refuses `--full`, `--fields`, `--max-bytes` and `--limit`, which shape only the JSON output; `--json` and `--format` still pick the shape of an error.

```sh
mb card query 1 --json
mb card query 1 --json --limit 20
mb card query 1 --export-format csv > export.csv
mb card query 1 --export-format json > export.json
mb card query 1 --export-format xlsx > export.xlsx
mb card query 1 --parameters '[{"type":"category","value":"A","target":["variable",["template-tag","c"]]}]'
```

| Flag                    | Description                                                                                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--export-format <fmt>` | Stream the export instead of the JSON envelope. One of `csv`, `json`, `xlsx`.                                                                                                                                            |
| `--parameters <json>`   | JSON array of Metabase parameter objects (the same shape Metabase POSTs from a dashboard).                                                                                                                               |
| `--limit <n>`           | Cap rows kept in the JSON envelope. Refused with `--export-format`.                                                                                                                                                      |
| `--format-rows`         | Streamed exports only: format values as Metabase displays them, the card's column settings included (default `false`). Refused without `--export-format`.                                                                |
| `--pivot-results`       | With `--export-format csv` or `xlsx`: lay a pivot question's rows out as the pivot, with its subtotals (default `false`). Refused when the server has pivoted exports turned off (the `enable-pivoted-exports` setting). |
| `--csv-include-bom`     | With `--export-format csv`: open the file with a UTF-8 byte order mark, so Excel reads it as UTF-8 (default `false`). Metabase v63+.                                                                                     |

### `mb card alerts <id>`

List the alerts watching this card. Manage them with `mb alert create|update|send|archive`, which take the alert id printed here.

```sh
mb card alerts 94
mb card alerts 94 --include-inactive --json
```

| Flag                 | Description                         |
| -------------------- | ----------------------------------- |
| `--include-inactive` | Include archived (inactive) alerts. |

### `mb card create`

```sh
cat card.json | mb card create
mb card create --file card.json
mb card create --body '{"name":"x","display":"table","dataset_query":{...},"visualization_settings":{}}'
```

| Flag            | Description             |
| --------------- | ----------------------- |
| `--body <json>` | Inline JSON body.       |
| `--file <path>` | Path to JSON body file. |

### `mb card update <id>`

Patch a card. Body is a partial subset of the create shape (`name`, `display`, `dataset_query`, `visualization_settings`, `description`, `archived`, `collection_id`, `dashboard_id`, `cache_ttl`, `parameters`, `parameter_mappings`, etc.). Only the keys you send are touched. If `dataset_query` is MBQL 5 (`lib/type: "mbql/query"`) it goes through the same pre-flight validation as `card create` and `mb query`; pass `--skip-validate` to bypass.

```sh
cat patch.json | mb card update 1
mb card update 1 --file patch.json
mb card update 1 --body '{"name":"renamed"}'
mb card update 1 --body '{"display":"bar"}'
mb card update 1 --body '{"archived":true}'
mb card update 1 --file patch.json --skip-validate
```

| Flag              | Description                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--body <json>`   | Inline JSON body.                                                                                                                                      |
| `--file <path>`   | Path to JSON body file.                                                                                                                                |
| `--skip-validate` | Skip the local MBQL 5 pre-flight validation; let the server be the authority. Use only when the bundled schema disagrees with what the server accepts. |

### `mb card verify <id>`

Mark a card verified, or withdraw the mark with `--remove` (`POST /api/moderation-review` with `moderated_item_type: "card"`). Admins only. Verified content carries a check mark in the product and ranks higher in search (`search --verified`). Each call adds a review and makes it the card's most recent one; `--remove` records a review with no status, which withdraws the verification. Changing the card's query (`card update` with a new `dataset_query`, or a revision revert) withdraws it too: the server records a review with no status and a note saying the edit unverified it. `card get <id> --fields moderation_reviews --json` reads the card's reviews, newest first; the first one's `status` is the current state. Prints the review: `id`, `moderated_item_id`, `moderated_item_type`, `status` (`verified` or `null`), `text`, `most_recent`; `--full` adds `moderator_id` and the timestamps. Needs the `content_verification` premium feature (Pro/Enterprise); the command is refused by name before any request without it.

```sh
mb card verify 1
mb card verify 1 --text "Reviewed the joins" --json
mb card verify 1 --remove
```

| Flag            | Description                                       |
| --------------- | ------------------------------------------------- |
| `--text <note>` | Note stored with the review.                      |
| `--remove`      | Withdraw the verification instead of granting it. |

### `mb card archive <id>`

Soft-delete a card by setting `archived: true`. The archived card stays available via `card list --filter archived` and `card get <id>` until permanently deleted server-side. To unarchive (or otherwise toggle the flag) use `mb card update <id> --body '{"archived":false}'`.

```sh
mb card archive 1
mb card archive 1 --json
```

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

### `mb dashboard subscriptions <id>`

List the subscriptions delivering this dashboard. Manage them with `mb subscription create|update|archive`, which take the subscription id printed here.

```sh
mb dashboard subscriptions 10
mb dashboard subscriptions 10 --json
```

| Flag         | Description                                         |
| ------------ | --------------------------------------------------- |
| `--archived` | Show archived subscriptions instead of active ones. |

#### Dashboard parameters (filters)

A dashboard's `parameters` are its filter widgets. They're typed (`Parameter` schema): an invalid `type` is rejected at the CLI boundary with a message that echoes the full allowed enum (`string/=`, `string/contains`, `number/between`, `date/range`, `category`, `id`, `temporal-unit`, …).

Read them off the dashboard with `mb dashboard get <id> --fields parameters --json` (or `--full` for the whole record). There is no separate read verb — they're part of the dashboard.

Editing replaces the **whole** `parameters` array, so it's a read-modify-write loop: read the current set, modify it, and send it all back via `mb dashboard create`/`mb dashboard update --body '{"parameters":[…]}'`; omitting a parameter deletes it. Each parameter's `id` is a descriptive string you choose (reuse the `slug`, e.g. `order_status`), unique within the dashboard — Metabase stores any non-blank string as-is, so there is no need to generate a random id (use `mb uuid` only if you genuinely want an opaque one). Bind a parameter to a card column through a dashcard's `parameter_mappings`, whose `parameter_id` must match a parameter `id` exactly.

### `mb dashboard parameter-values <dashboard-id> <parameter-id>`

Fetch the selectable values for one dashboard parameter (`{values, has_more_values}`). Values come from the parameter's static list, its source card, or — for a parameter mapped to a field — the field's live distinct values (chain-filtered).

```sh
mb dashboard parameter-values 1 order_status --json
mb dashboard parameter-values 1 order_status --query Cam --json
```

| Flag               | Description                                                                            |
| ------------------ | -------------------------------------------------------------------------------------- |
| `--query <substr>` | Case-insensitive substring search (first 1000 matches) instead of the full value list. |

### `mb dashboard create`

The body accepts the same dashboard-level fields as the underlying `POST /api/dashboard` (`name`, `description`, `parameters`, `cache_ttl`, `collection_id`, `collection_position`). It also accepts optional `dashcards` and `tabs`: when either is present, the CLI chains a `PUT /api/dashboard/:id` after the create and returns the updated dashboard with its dashcards/tabs applied. Every dashcard must carry `card_id` explicitly: use a positive card id for a saved question or `null` for a virtual card. Use a negative `id` on a dashcard to indicate one the server should newly create.

```sh
cat dashboard.json | mb dashboard create
mb dashboard create --file dashboard.json
mb dashboard create --body '{"name":"My Dashboard","collection_id":4}'
mb dashboard create --body '{"name":"D","dashcards":[{"id":-1,"card_id":42,"row":0,"col":0,"size_x":12,"size_y":6}]}'
```

| Flag            | Description                                         |
| --------------- | --------------------------------------------------- |
| `--body <json>` | Inline JSON body.                                   |
| `--file <path>` | Path to JSON body file. Use `-` to read from stdin. |

### `mb dashboard update <id>`

Patch a dashboard. To edit the dashcard set, send the entire `dashcards` array — IDs not in the array get deleted, and a negative `id` indicates a new dashcard the server should create. Every entry must carry `card_id` explicitly, including existing dashcards; use `null` for virtual cards.

```sh
cat patch.json | mb dashboard update 1
mb dashboard update 1 --file patch.json
mb dashboard update 1 --body '{"name":"renamed"}'
mb dashboard update 1 --body '{"dashcards":[{"id":-1,"card_id":42,"row":0,"col":0,"size_x":12,"size_y":6}]}'
```

### `mb dashboard update-dashcard <dashboard-id> <dashcard-id>`

Patch a single dashcard's layout or settings. The command does the round-trip for you: `GET /api/dashboard/:id`, merges the patch into the targeted dashcard while preserving every other dashcard verbatim, then `PUT`s the whole array back.

```sh
mb dashboard update-dashcard 1 5 --body '{"row":2,"col":0}'
mb dashboard update-dashcard 1 5 --body '{"size_x":12,"size_y":4}'
cat patch.json | mb dashboard update-dashcard 1 5
```

| Patch field              | Type                               |
| ------------------------ | ---------------------------------- |
| `row`, `col`             | non-negative integer               |
| `size_x`, `size_y`       | positive integer                   |
| `dashboard_tab_id`       | integer or `null`                  |
| `parameter_mappings`     | array of parameter-mapping objects |
| `inline_parameters`      | array of strings                   |
| `visualization_settings` | object                             |

The patch must contain at least one field; an empty object is rejected before the network round-trip.

### `mb dashboard copy <id>`

Copy a dashboard, with its tabs and dashcards, into a collection (`POST /api/dashboard/:id/copy`). The copy references the source cards; `--deep` duplicates its questions and metrics into the target collection instead and keeps referencing its models. A dashboard holding dashboard questions (cards saved inside the dashboard) must be copied with `--deep`. Copied into the source dashboard's own collection, a duplicated card's name gets the suffix ` - Duplicate`, translated into the user's Metabase language. Archived cards, cards you cannot read, and every card on a dashcard whose main card you cannot read are left out, and the output lists them by id as `uncopied`, once per dashcard they sat on (the text summary names each id once). A left-out main card takes its dashcard with it; a left-out series card stays on a dashcard whose main card is referenced and is dropped from one whose main card is duplicated. Action, link and placeholder dashcards are not copied. Prints the new dashboard.

```sh
mb dashboard copy 1
mb dashboard copy 1 --name "Orders (copy)" --collection-id 4 --json
mb dashboard copy 1 --deep --json
```

| Flag                        | Description                                                      |
| --------------------------- | ---------------------------------------------------------------- |
| `--name <name>`             | Name for the copy (default: the source name).                    |
| `--description <text>`      | Description for the copy (default: the source description).      |
| `--collection-id <id>`      | Collection to copy into (default: the root collection).          |
| `--collection-position <n>` | Pin the copy at this position in the collection.                 |
| `--deep`                    | Duplicate the questions and metrics instead of referencing them. |

### `mb dashboard verify <id>`

Mark a dashboard verified, or withdraw the mark with `--remove` (`POST /api/moderation-review` with `moderated_item_type: "dashboard"`). Admins only. Verified content carries a check mark in the product and ranks higher in search (`search --verified`). Each call adds a review and makes it the dashboard's most recent one; `--remove` records a review with no status, which withdraws the verification. `dashboard get <id> --fields moderation_reviews --json` reads the dashboard's reviews, newest first; the first one's `status` is the current state. Prints the review: `id`, `moderated_item_id`, `moderated_item_type`, `status` (`verified` or `null`), `text`, `most_recent`; `--full` adds `moderator_id` and the timestamps. Needs the `content_verification` premium feature (Pro/Enterprise); the command is refused by name before any request without it.

```sh
mb dashboard verify 1
mb dashboard verify 1 --text "Reviewed the joins" --json
mb dashboard verify 1 --remove
```

| Flag            | Description                                       |
| --------------- | ------------------------------------------------- |
| `--text <note>` | Note stored with the review.                      |
| `--remove`      | Withdraw the verification instead of granting it. |

### `mb dashboard archive <id>`

Soft-delete a dashboard by setting `archived: true`. The archived dashboard stays available via `dashboard list --filter archived` and `dashboard get <id>` until permanently deleted server-side. To unarchive use `mb dashboard update <id> --body '{"archived":false}'`.

```sh
mb dashboard archive 1
mb dashboard archive 1 --json
```

## Snippets

CRUD on `/api/native-query-snippet`. A snippet is a named, reusable piece of native (SQL) query text — referenced from cards via `{{snippet: Name}}`. The list endpoint returns either active or archived rows (mutually exclusive — pass `--archived` to swap).

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

### `mb snippet create`

```sh
cat snippet.json | mb snippet create
mb snippet create --file snippet.json
mb snippet create --body '{"name":"active","content":"WHERE active = true"}'
```

| Flag            | Description             |
| --------------- | ----------------------- |
| `--body <json>` | Inline JSON body.       |
| `--file <path>` | Path to JSON body file. |

Body fields: `name` (required), `content` (required), `description` (optional), `collection_id` (optional positive integer).

### `mb snippet update <id>`

Patch a snippet. Body is a partial subset of the create shape plus `archived`. Only the keys you send are touched.

```sh
cat patch.json | mb snippet update 1
mb snippet update 1 --file patch.json
mb snippet update 1 --body '{"name":"renamed"}'
mb snippet update 1 --body '{"archived":true}'
```

| Flag            | Description             |
| --------------- | ----------------------- |
| `--body <json>` | Inline JSON body.       |
| `--file <path>` | Path to JSON body file. |

### `mb snippet archive <id>`

Soft-delete a snippet by setting `archived: true`. To unarchive use `mb snippet update <id> --body '{"archived":false}'`.

```sh
mb snippet archive 1
mb snippet archive 1 --json
```

## Data actions

CRUD on `/api/action` plus `execute`. A data action is a parameterized native SQL write (`INSERT`, `UPDATE`, `DELETE`) filed in a collection. Data actions are off by default: an admin must enable them on the target database first. `mb data-action create` authors data actions only — no `model_id`, no implicit data actions — and needs a server whose data actions do not require a model.

### `mb data-action list`

```sh
mb data-action list
mb data-action list --json
```

### `mb data-action get <id>`

```sh
mb data-action get 1
mb data-action get 1 --json --full
```

### `mb data-action create`

```sh
cat data-action.json | mb data-action create
mb data-action create --file data-action.json
mb data-action create --file data-action.json --skip-validate
```

| Flag              | Description                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--body <json>`   | Inline JSON body.                                                                                                                                      |
| `--file <path>`   | Path to JSON body file.                                                                                                                                |
| `--skip-validate` | Skip the local MBQL 5 pre-flight validation; let the server be the authority. Use only when the bundled schema disagrees with what the server accepts. |

Body fields: `name` (required), `type` (required, `"query"`), `database_id` (required), `dataset_query` (required native query whose `{{tag}}` placeholders are its inputs), `parameters` (one per template tag), `collection_id` (optional; the root when omitted), `description`, `visualization_settings`.

### `mb data-action update <id>`

Patch a data action; the body carries only the fields to change (`name`, `database_id`, `dataset_query`, `parameters`, `collection_id`, `description`, `visualization_settings`, `archived`).

```sh
cat patch.json | mb data-action update 1
mb data-action update 1 --body '{"name":"Rename an order"}'
```

### `mb data-action archive <id>`

```sh
mb data-action archive 1
```

### `mb data-action delete <id>`

Delete a data action and the dashboard buttons that run it.

```sh
mb data-action delete 1 --yes
```

### `mb data-action execute <id>`

Run a data action. The body is `{"parameters": {...}}` keyed by parameter id; the result reports `rows-affected`.

```sh
mb data-action execute 1 --body '{"parameters":{"id":1,"note":"rush"}}'
mb data-action execute 1 --file values.json
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

### `mb segment create`

```sh
cat segment.json | mb segment create
mb segment create --file segment.json
mb segment create --file segment.json --skip-validate
```

| Flag              | Description                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--body <json>`   | Inline JSON body.                                                                                                                                      |
| `--file <path>`   | Path to JSON body file.                                                                                                                                |
| `--skip-validate` | Skip the local MBQL 5 pre-flight validation; let the server be the authority. Use only when the bundled schema disagrees with what the server accepts. |

Body fields: `name` (required), `table_id` (required positive integer), `definition` (required MBQL filter object), `description` (optional). If `definition` is MBQL 5 (`lib/type: "mbql/query"`) it goes through the same pre-flight validation as `card create` and `mb query`; pass `--skip-validate` to bypass.

### `mb segment update <id>`

Patch a segment. The body MUST include `revision_message`. Other keys are partial: `name`, `definition`, `archived`, `description`, `caveats`, `points_of_interest`, `show_in_getting_started`. If `definition` is MBQL 5 (`lib/type: "mbql/query"`) it goes through the same pre-flight validation as `segment create`; pass `--skip-validate` to bypass.

```sh
cat patch.json | mb segment update 1
mb segment update 1 --file patch.json
mb segment update 1 --body '{"name":"renamed","revision_message":"rename"}'
mb segment update 1 --file patch.json --skip-validate
```

| Flag              | Description                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--body <json>`   | Inline JSON body.                                                                                                                                      |
| `--file <path>`   | Path to JSON body file.                                                                                                                                |
| `--skip-validate` | Skip the local MBQL 5 pre-flight validation; let the server be the authority. Use only when the bundled schema disagrees with what the server accepts. |

### `mb segment archive <id>`

Soft-delete a segment by setting `archived: true`. The default revision message is `"Archived via mb CLI"`; override with `--revision-message`.

```sh
mb segment archive 1
mb segment archive 1 --revision-message "deprecated"
```

| Flag                        | Description                                 |
| --------------------------- | ------------------------------------------- |
| `--revision-message <text>` | Audit-log message recorded with the change. |

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

### `mb measure create`

```sh
cat measure.json | mb measure create
mb measure create --file measure.json
mb measure create --file measure.json --skip-validate
```

| Flag              | Description                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--body <json>`   | Inline JSON body.                                                                                                                                      |
| `--file <path>`   | Path to JSON body file.                                                                                                                                |
| `--skip-validate` | Skip the local MBQL 5 pre-flight validation; let the server be the authority. Use only when the bundled schema disagrees with what the server accepts. |

Body fields: `name` (required), `table_id` (required positive integer), `definition` (required MBQL aggregation object), `description` (optional). If `definition` is MBQL 5 (`lib/type: "mbql/query"`) it goes through the same pre-flight validation as `card create` and `mb query`; pass `--skip-validate` to bypass.

### `mb measure update <id>`

Patch a measure. The body MUST include `revision_message`. Other keys are partial: `name`, `definition`, `archived`, `description`. If `definition` is MBQL 5 (`lib/type: "mbql/query"`) it goes through the same pre-flight validation as `measure create`; pass `--skip-validate` to bypass.

```sh
cat patch.json | mb measure update 1
mb measure update 1 --file patch.json
mb measure update 1 --body '{"name":"renamed","revision_message":"rename"}'
mb measure update 1 --file patch.json --skip-validate
```

| Flag              | Description                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--body <json>`   | Inline JSON body.                                                                                                                                      |
| `--file <path>`   | Path to JSON body file.                                                                                                                                |
| `--skip-validate` | Skip the local MBQL 5 pre-flight validation; let the server be the authority. Use only when the bundled schema disagrees with what the server accepts. |

### `mb measure archive <id>`

Soft-delete a measure by setting `archived: true`. The default revision message is `"Archived via mb CLI"`; override with `--revision-message`.

```sh
mb measure archive 1
mb measure archive 1 --revision-message "deprecated"
```

| Flag                        | Description                                 |
| --------------------------- | ------------------------------------------- |
| `--revision-message <text>` | Audit-log message recorded with the change. |

## Dependencies

What Metabase content depends on and what depends on it, from `/api/ee/dependencies`. Metabase records an edge from every card, dashboard, document, snippet, transform, sandbox, segment or measure to what its query reads (a table, a card, a snippet, a transform's output), and analyses each dependent's query for errors traced back to what it reads. Every verb needs the `dependencies` premium feature (Pro/Enterprise) and is refused by name before any request without it; `graph` works on every supported server (a measure as its starting entity from Metabase v59), the other four need Metabase v59 or newer. The graph is recomputed by a background job shortly after content changes, so a freshly saved query can take a few seconds to appear.

Every row is `{ id, type, data }` plus, where the verb reports it, `dependents_count`, a map from usage kind (`question`, `model`, `metric`, `dashboard`, `document`, `transform`, …) to how many depend on the row directly, or `null` when nothing does. `data` names and places the entity by kind: a table carries `name`, `display_name`, `db_id`, `schema` and its `db` (`{ id, name }`); a card `name`, `type` (`question` | `model` | `metric`), `database_id`, `view_count` and its `collection` (plus the `dashboard` or `document` it lives inside, when it does); a dashboard or document its `view_count` and `collection`, a snippet its `collection`; a segment, measure or sandbox its `table` (`{ id, name, display_name }`); a transform carries its `name` and `description` only, with `table` always `null`. The compact projection keeps those; `--full` adds the heavier hydrations (a table's `fields`, a card's `result_metadata`, creators, last-edit info). An entity's location, which `--query` matches and `--sort-column location` orders by and the text table shows, is the dashboard, document or collection holding a card, a table's database, a segment's or measure's table, and the collection of a snippet, dashboard or document; a sandbox has none. A transform's row carries no collection: `unreferenced` and `breaking`, which match and sort on the server, use its collection's name (`Transforms` for one at the root), while `dependents`, `broken` and the text table give it no location.

Archived and dropped content: from Metabase v63 `graph` includes archived upstream entities; older servers leave them out. `dependents`, `broken` and `unreferenced` leave archived cards, dashboards, documents, snippets, segments and measures out on every server. From v63 `unreferenced` and `breaking` also keep dropped and hidden tables, and `breaking` keeps archived sources, so a dropped table or an archived card that broke its dependents is reported; older servers leave all of these out, and only an `archived` parameter the newer ones dropped would bring them back, so the CLI does not offer it.

`<type>` is one of `table`, `card`, `snippet`, `transform`, `dashboard`, `document`, `sandbox`, `segment`, `measure`.

### `mb dependency graph <type> <id>`

Show everything an entity depends on, directly or transitively: `nodes` holds the entity and every upstream entity, each with its `dependents_count`; `edges` run from a dependent to what it depends on.

```sh
mb dependency graph card 1
mb dependency graph table 12 --json
mb dependency graph transform 3 --fields edges
```

### `mb dependency dependents <type> <id>`

List the entities that depend directly on an entity, each with its own `dependents_count`, so a chain can be followed one hop at a time. The server filters and sorts; `--limit` / `--offset` window the answer here.

```sh
mb dependency dependents table 12
mb dependency dependents card 1 --dependent-types card,dashboard --json
mb dependency dependents table 12 --broken --json
mb dependency dependents card 1 --sort-column view-count --sort-direction desc
```

| Flag                             | Description                                                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `--dependent-types`              | Comma-separated entity kinds to keep (the `<type>` vocabulary).                                                                   |
| `--dependent-card-types`         | Comma-separated card kinds to keep: `question`, `model`, `metric`. Narrows card dependents only; other kinds stay.                |
| `--broken`                       | Only the dependents whose query analysis failed, whatever the cause; their `dependents_count` then counts only broken dependents. |
| `--query`                        | Keep entities whose name or location contains this text, case-insensitively. Must not be blank.                                   |
| `--include-personal-collections` | Also list content in personal collections (left out by default).                                                                  |
| `--sort-column`                  | `name` (default), `location` or `view-count`.                                                                                     |
| `--sort-direction`               | `asc` (default) or `desc`.                                                                                                        |

### `mb dependency broken <type> <id>`

List the entities whose queries an entity has broken: those where query analysis traced a validation error (a missing column, a syntax error) back to it, whether they read it directly or through others. Rows are `{ id, type, data }` with no `dependents_count`. Only a table, a card or (from Metabase v60) a transform can be traced as the cause, so any other `<type>` lists nothing. `dependents --broken` answers a different set: the direct dependents whose analysis failed for any cause. Takes the `dependents` flags except `--broken` and `--query`.

```sh
mb dependency broken table 12
mb dependency broken card 1 --dependent-types card --json
```

### `mb dependency unreferenced`

List the entities nothing depends on, across the whole instance. Only a dependent the caller can read and that is not archived counts, so an entity used only by archived content, or by content in collections the caller cannot read, is listed. Every kind is listed unless `--types` narrows it; a `--query` leaves sandboxes out, since they have no name or location to match. The server pages the answer, so `total` is its count and `--limit` / `--offset` size the request.

```sh
mb dependency unreferenced
mb dependency unreferenced --types card --card-types model,metric --json
mb dependency unreferenced --query orders --sort-column location --json
```

| Flag                             | Description                                                                                              |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `--types`                        | Comma-separated entity kinds to list (the `<type>` vocabulary).                                          |
| `--card-types`                   | Comma-separated card kinds to list: `question`, `model`, `metric`. Narrows cards only; other kinds stay. |
| `--query`                        | Keep entities whose name or location contains this text, case-insensitively. Must not be blank.          |
| `--include-personal-collections` | Also list content in personal collections (left out by default).                                         |
| `--sort-column`                  | `name` (default), `location`, `dependents-with-errors` or `dependents-errors`.                           |
| `--sort-direction`               | `asc` (default) or `desc`.                                                                               |

### `mb dependency breaking`

List the entities whose dependents carry query errors, across the whole instance. Each row is a source of breakage with `dependents_errors`, the validation errors traced back to it, each naming the dependent (`analyzed_entity_type`, `analyzed_entity_id`) it was found in and its `error_type` (`missing-column`, `syntax-error`, …). Cards and tables are listed unless `--types` says otherwise; only a table, a card or (from Metabase v60) a transform can be a source, so any other kind lists nothing. Takes the `unreferenced` flags.

```sh
mb dependency breaking
mb dependency breaking --types table --json
mb dependency breaking --sort-column dependents-errors --sort-direction desc --json
```

## Timelines

CRUD on `/api/timeline`. A timeline is a named collection of dated events rendered as annotations on time-series charts. Timelines live in collections (`collection_id: null` = root) and carry an icon (`star`, `cake`, `mail`, `warning`, `bell`, `cloud`).

### `mb timeline list`

```sh
mb timeline list
mb timeline list --json
mb timeline list --archived --json
```

| Flag         | Description                                     |
| ------------ | ----------------------------------------------- |
| `--archived` | Show archived timelines instead of active ones. |

### `mb timeline get <id>`

```sh
mb timeline get 1
mb timeline get 1 --json --full
```

### `mb timeline events <id>`

List the events on a timeline. Archived events are excluded unless `--archived` is passed (which returns both).

```sh
mb timeline events 1
mb timeline events 1 --archived --json
```

| Flag         | Description              |
| ------------ | ------------------------ |
| `--archived` | Include archived events. |

### `mb timeline create`

```sh
mb timeline create --body '{"name":"Releases"}'
cat timeline.json | mb timeline create
mb timeline create --file timeline.json
```

| Flag            | Description             |
| --------------- | ----------------------- |
| `--body <json>` | Inline JSON body.       |
| `--file <path>` | Path to JSON body file. |

Body fields: `name` (required), `description` (optional), `icon` (optional, default `star`), `collection_id` (optional positive integer, omit for the root collection), `default` (optional boolean marking the collection's default timeline).

### `mb timeline update <id>`

Patch a timeline. Body is a partial subset of the create shape plus `archived`. Only the keys you send are touched. Changing `archived` cascades to every event on the timeline.

```sh
mb timeline update 1 --body '{"name":"Product releases"}'
cat patch.json | mb timeline update 1
mb timeline update 1 --file patch.json
```

| Flag            | Description             |
| --------------- | ----------------------- |
| `--body <json>` | Inline JSON body.       |
| `--file <path>` | Path to JSON body file. |

### `mb timeline archive <id>`

Soft-delete a timeline (and, by server-side cascade, all its events) by setting `archived: true`. To unarchive use `mb timeline update <id> --body '{"archived":false}'`.

```sh
mb timeline archive 1
mb timeline archive 1 --json
```

### `mb timeline delete <id>`

Permanently delete a timeline and all its events. Irreversible — prefer `mb timeline archive` unless you mean it. Prompts for confirmation on a TTY; requires `--yes` otherwise.

```sh
mb timeline delete 1 --yes
mb timeline delete 1
```

| Flag    | Description        |
| ------- | ------------------ |
| `--yes` | Skip confirmation. |

## Timeline events

CRUD on `/api/timeline-event`. An event is a dated annotation on a timeline. There is no server-side list endpoint — list events with `mb timeline events <id>`.

### `mb timeline-event get <id>`

```sh
mb timeline-event get 1
mb timeline-event get 1 --json --full
```

### `mb timeline-event create`

```sh
mb timeline-event create --body '{"name":"v2 launch","timestamp":"2026-07-01T00:00:00Z","timezone":"UTC","time_matters":false,"timeline_id":1}'
cat event.json | mb timeline-event create
mb timeline-event create --file event.json
```

| Flag            | Description             |
| --------------- | ----------------------- |
| `--body <json>` | Inline JSON body.       |
| `--file <path>` | Path to JSON body file. |

Body fields: `name` (required), `timestamp` (required, ISO 8601), `timezone` (required, IANA name like `UTC` or `America/New_York`), `time_matters` (required boolean — `true` when the time of day is significant, `false` when only the date is), `timeline_id` (required positive integer), `description` (optional), `icon` (optional, default: the timeline's icon).

### `mb timeline-event update <id>`

Patch an event. Body is a partial subset of the create shape plus `archived`. Only the keys you send are touched; `timeline_id` moves the event to another timeline.

```sh
mb timeline-event update 1 --body '{"name":"v2.1 launch"}'
cat patch.json | mb timeline-event update 1
mb timeline-event update 1 --file patch.json
```

| Flag            | Description             |
| --------------- | ----------------------- |
| `--body <json>` | Inline JSON body.       |
| `--file <path>` | Path to JSON body file. |

### `mb timeline-event archive <id>`

Soft-delete an event by setting `archived: true`. To unarchive use `mb timeline-event update <id> --body '{"archived":false}'`.

```sh
mb timeline-event archive 1
mb timeline-event archive 1 --json
```

### `mb timeline-event delete <id>`

Permanently delete an event. Prompts for confirmation on a TTY; requires `--yes` otherwise.

```sh
mb timeline-event delete 1 --yes
mb timeline-event delete 1
```

| Flag    | Description        |
| ------- | ------------------ |
| `--yes` | Skip confirmation. |

## Dashboard subscriptions

Read and write dashboard subscriptions on `/api/pulse`. A subscription delivers a rendered dashboard on a schedule — by email, to a Slack channel, or to an HTTP webhook. It pins the dashboard's cards by both `id` (the card) and `dashboard_card_id` (its placement); `mb dashboard cards <dashboard-id>` prints both.

A subscription's `dashboard_id` and `collection_id` are fixed at creation. There is no delete — archiving is the terminal state, and it also disables every channel.

### `mb subscription list`

```sh
mb subscription list
mb subscription list --dashboard-id 10 --json
mb subscription list --archived --json
```

| Flag                  | Description                                         |
| --------------------- | --------------------------------------------------- |
| `--dashboard-id <id>` | Only subscriptions on this dashboard.               |
| `--archived`          | Show archived subscriptions instead of active ones. |

Listing from the dashboard side is `mb dashboard subscriptions <dashboard-id>`.

### `mb subscription get <id>`

```sh
mb subscription get 1
mb subscription get 1 --full --json
```

The compact view returns `id`, `name`, `dashboard_id`, `collection_id`, `archived`, `skip_if_empty`, plus the pinned `cards` and the `channels` with their schedules and recipients. `--full` adds the hydrated creator, entity ids, and per-card download permissions.

### `mb subscription create`

The body needs `name`, `dashboard_id`, `cards`, and `channels`.

Each channel names a `channel_type` (`email`, `slack`, `http`) and a `schedule_type` (`hourly`, `daily`, `weekly`, `monthly`) plus the fields that schedule needs: `daily` needs `schedule_hour` (0–23); `weekly` also needs `schedule_day` (`mon`…`sun`); `monthly` also needs `schedule_frame` (`first`, `mid`, `last`). Email recipients are `{"email":"a@b.com"}` or `{"id":<user-id>}`; Slack targets a channel with `"details":{"channel":"#general"}`. A channel is `enabled` unless you say otherwise.

```sh
mb subscription create --body '{"name":"Weekly orders","dashboard_id":10,"cards":[{"id":94,"dashboard_card_id":87,"include_csv":false,"include_xls":false}],"channels":[{"channel_type":"email","schedule_type":"daily","schedule_hour":8,"recipients":[{"email":"team@example.com"}]}]}'
cat subscription.json | mb subscription create
mb subscription create --file subscription.json
```

| Flag            | Description                                         |
| --------------- | --------------------------------------------------- |
| `--body <json>` | Inline JSON body.                                   |
| `--file <path>` | Path to JSON body file. Use `-` to read from stdin. |

### `mb subscription update <id>`

Patches `name`, `cards`, `channels`, `skip_if_empty`, `parameters`, `archived`. `cards` and `channels` each replace the whole list, so send every one you want to keep — `mb subscription get <id> --full` prints the current set.

The update reads the subscription first and carries `archived` and `skip_if_empty` forward when your patch omits them. That is load-bearing: `PUT /api/pulse/:id` defaults every omitted key, and both of those default to `false`, so a raw name-only PUT would un-archive the subscription and clear `skip_if_empty`.

```sh
mb subscription update 1 --body '{"name":"Daily orders"}'
mb subscription update 1 --body '{"channels":[{"channel_type":"email","schedule_type":"weekly","schedule_hour":8,"schedule_day":"mon","recipients":[{"email":"team@example.com"}]}]}'
mb subscription update 1 --file patch.json
```

| Flag            | Description                                         |
| --------------- | --------------------------------------------------- |
| `--body <json>` | Inline JSON body.                                   |
| `--file <path>` | Path to JSON body file. Use `-` to read from stdin. |

### `mb subscription archive <id>`

Archive a subscription, stopping all deliveries. Also disables every channel on it, so restoring means un-archiving and then re-enabling the channels.

```sh
mb subscription archive 1
mb subscription archive 1 --json
```

## Question alerts

Read and write question alerts on `/api/notification`. An alert watches one card and delivers it when a send condition fires on a schedule: `has_result` (the card returned any row), or `goal_above` / `goal_below` (both need a goal set on the card's visualization).

Schedules are Quartz cron strings — `0 0 8 * * ? *` is daily at 08:00. `/api/notification` also carries Metabase's internal system-event notifications; `mb alert` scopes every request to card alerts, so they never appear.

Archiving deactivates an alert rather than deleting it: `mb alert list --include-inactive` still finds it, and `mb alert update <id> --body '{"active":true}'` brings it back.

### `mb alert list`

```sh
mb alert list
mb alert list --card-id 94 --json
mb alert list --include-inactive --json
```

| Flag                  | Description                         |
| --------------------- | ----------------------------------- |
| `--card-id <id>`      | Only alerts watching this card.     |
| `--creator-id <id>`   | Only alerts created by this user.   |
| `--recipient-id <id>` | Only alerts delivered to this user. |
| `--include-inactive`  | Include archived (inactive) alerts. |

Listing from the question side is `mb card alerts <card-id>`.

### `mb alert get <id>`

```sh
mb alert get 9
mb alert get 9 --full --json
```

The compact view returns `id`, `active`, `creator_id`, the `payload` (`card_id`, `send_condition`, `send_once`), the cron `subscriptions`, and the `handlers` with their recipients. `--full` adds the hydrated card the alert watches.

### `mb alert create`

The body needs `payload`, `subscriptions`, and `handlers`. Each handler names a `channel_type` (`channel/email`, `channel/slack`, `channel/http`) and its `recipients`; a recipient is `{"type":"notification-recipient/user","user_id":3}` or `{"type":"notification-recipient/raw-value","details":{"value":"a@b.com"}}`.

```sh
mb alert create --body '{"payload":{"card_id":94,"send_condition":"has_result"},"subscriptions":[{"cron_schedule":"0 0 8 * * ? *"}],"handlers":[{"channel_type":"channel/email","recipients":[{"type":"notification-recipient/raw-value","details":{"value":"team@example.com"}}]}]}'
cat alert.json | mb alert create
mb alert create --file alert.json
```

| Flag            | Description                                         |
| --------------- | --------------------------------------------------- |
| `--body <json>` | Inline JSON body.                                   |
| `--file <path>` | Path to JSON body file. Use `-` to read from stdin. |

### `mb alert update <id>`

Patches the top-level fields you send: `payload`, `subscriptions`, `handlers`, `active`. Fields inside `payload` merge over the current ones, so `{"payload":{"send_condition":"goal_above"}}` keeps the card. `subscriptions` and `handlers` each replace the whole list — `mb alert get <id>` prints the current set. An alert cannot be moved to a different card.

The update reads the alert first and merges your patch over it. That is load-bearing: `PUT /api/notification/:id` is a spec-diff, and a body whose `id` doesn't match the stored one makes Metabase delete the alert and insert a replacement under a fresh id.

```sh
mb alert update 9 --body '{"payload":{"send_condition":"goal_above"}}'
mb alert update 9 --body '{"subscriptions":[{"cron_schedule":"0 0 9 * * ? *"}]}'
mb alert update 9 --body '{"active":true}'
```

| Flag            | Description                                         |
| --------------- | --------------------------------------------------- |
| `--body <json>` | Inline JSON body.                                   |
| `--file <path>` | Path to JSON body file. Use `-` to read from stdin. |

### `mb alert send <id>`

Send an alert now, off-schedule. Delivers to every handler, ignoring the send condition. The channel must be configured on the server (email needs SMTP set up).

```sh
mb alert send 9
mb alert send 9 --json
```

### `mb alert archive <id>`

Archive an alert, stopping all deliveries and dropping its scheduled trigger.

```sh
mb alert archive 9
mb alert archive 9 --json
```

## Collections

Read and edit collections on `/api/collection`. Collections are the folders that contain cards, dashboards, and other collections. The list endpoint surfaces a virtual root collection (id `"root"`) alongside regular numeric ids; `get` and `items` accept the aliases and entity ids described below, while `update` and `archive` take the numeric id only.

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

Fetch the full collection hierarchy as a nested tree. Output is always JSON — the recursive structure does not render meaningfully as a key/value table. The tree leaves out the Library collections (`library`, `library-data`, `library-metrics`) unless you pass `--include-library`; the default `collection list` includes them. The tree is the server's JSON as-is, so `--full`, `--fields` and `--max-bytes` are refused.

```sh
mb collection tree
mb collection tree --json
mb collection tree --include-library
```

| Flag                | Description                      |
| ------------------- | -------------------------------- |
| `--include-library` | Include the Library collections. |

### `mb collection create`

Create a collection from a JSON spec. The body accepts the same fields as `POST /api/collection`: `name` (required), `description`, `parent_id` (omit or `null` for the root), `namespace`, and `authority_level`.

```sh
cat collection.json | mb collection create
mb collection create --file collection.json
mb collection create --body '{"name":"My Collection","parent_id":4}'
mb collection create --body '{"name":"ETL"}' --namespace transforms
```

| Flag               | Description                                                                                                                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--body <json>`    | Inline JSON body.                                                                                                                                                                                                |
| `--file <path>`    | Path to JSON body file. Use `-` to read from stdin.                                                                                                                                                              |
| `--namespace <ns>` | Collection namespace (`transforms`, `snippets`, `analytics`, `shared-tenant-collection`, `tenant-specific`). Omit for a normal collection; required for a collection a transform's `collection_id` can point at. |

### `mb collection update <id>`

Rename, describe, move, trash, or restore a collection. Patches only what you send. Pass the patch as flags, or as a JSON body with any of `name`, `description` (`null` clears it), `parent_id` (`null` for the top level), `authority_level`, and `archived`; the two forms are alternatives, and a body beside a patch flag is refused with a `ConfigError` (exit 2). A body with no key, with a key outside that list, or with a value of the wrong type fails validation (exit 1) before any request.

```sh
mb collection update 4 --name "Marketing"
mb collection update 4 --description "Campaign reporting" --parent-id 2
mb collection update 4 --parent-id root
mb collection update 4 --clear-description
mb collection update 4 --archived false
mb collection update 4 --body '{"parent_id":null,"authority_level":"official"}'
mb collection update 4 --file patch.json --json
```

| Flag                       | Description                                                         |
| -------------------------- | ------------------------------------------------------------------- |
| `--name <text>`            | New name.                                                           |
| `--description <text>`     | New description.                                                    |
| `--clear-description`      | Remove the description. Refused beside `--description`.             |
| `--parent-id <id \| root>` | Collection to move it under, or `root` for the top level.           |
| `--archived <true\|false>` | `true` moves it to the trash, `false` restores it. Omit to keep it. |
| `--body <json>`            | Inline JSON body.                                                   |
| `--file <path>`            | Path to JSON body file. Use `-` to read from stdin.                 |

`<id>` is the integer id only; `root`, `trash`, and entity ids are refused before any request. A blank `--name` or `--description` (empty or whitespace only) is refused too, since the server takes a non-blank string; blank follows the server's whitespace set, so a no-break space counts as text.

The server reads a body without `archived` as `archived: false`, which would restore an archived collection. So when the patch leaves `archived` out, the CLI reads the collection first and sends its current state: an archived collection stays in the trash while you edit it, and comes back only with `--archived false` (or `"archived": false`). Restoring with `--parent-id` puts it under that parent instead of its old location; `--parent-id` alone moves an archived collection and leaves it in the trash.

The server ignores `parent_id` in a request that trashes a collection. So `--archived true` with `--parent-id` on a collection that is not in the trash is sent as two requests, the move with every other change and then the trash; if the second fails, the error says the collection was moved but not trashed.

Setting or clearing `authority_level` (`"official"`) needs admin and the Official Collections feature (Pro/Enterprise); without the feature the server answers 402. Sending the value the collection already has is not a change and passes on any instance.

### `mb collection archive <id>`

Soft-delete a collection by setting `archived: true`. The archived collection stays available via `collection list --filter archived` until permanently deleted server-side. Restore it with `mb collection update <id> --archived false`.

```sh
mb collection archive 4
mb collection archive 4 --json
```

## Library

Curate the Metabase **Library** — a governed subtree (`library-data` "Data" for published tables, `library-metrics` "Metrics" for official metrics, under a `library` root). Tables published to Data appear first when people pick a data source and rank up in search, steering everyone toward trusted, analysis-ready tables. Requires Metabase v59 or newer, the `library` premium feature (Pro/Enterprise), and admin or data-analyst permission (Curate alone won't publish tables). Publish status surfaces on the table via `is_published` (`table get`/`table list`).

### `mb library get`

Show the Library and its Data/Metrics collection ids (`GET /api/ee/library/`). Errors if the Library hasn't been created yet.

```sh
mb library get
mb library get --json
```

### `mb library create`

Create the Library subtree (`POST /api/ee/library/`). Idempotent — returns the existing Library when it's already there.

```sh
mb library create
mb library create --json
```

### `mb library publish`

Publish tables (and their upstream dependencies) into the Library's Data collection (`POST /api/ee/data-studio/table/publish-tables`). The target Data collection is resolved automatically and the Library is created if it doesn't exist yet — there's no collection id to pass. Publishing does not add the Data collection to the git-sync scope; on an instance with remote sync configured, the command warns on stderr with the `mb git-sync add-collection <id>` invocation that makes exports carry the published tables' metadata.

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

CRUD on `/api/document`. A document is a rich-text page that mixes prose with embedded saved questions (`cardEmbed`) and inline links to Metabase entities (`smartLink`). The body is a [TipTap](https://tiptap.dev/) (ProseMirror) JSON tree stored under `content_type: application/json+vnd.prose-mirror`. The agent-facing format reference lives in the bundled `document` skill (`mb skills get document`). It's a baseline OSS feature — no premium token required, and every verb but `copy` runs on every supported server.

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

### `mb document create`

```sh
cat document.json | mb document create
mb document create --file document.json
mb document create --body '{"name":"Notes","document":{"type":"doc","content":[]}}'
```

| Flag            | Description             |
| --------------- | ----------------------- |
| `--body <json>` | Inline JSON body.       |
| `--file <path>` | Path to JSON body file. |

Body fields: `name` (required), `document` (required — the TipTap `doc` tree), `collection_id` (optional positive integer; `null` files it under "Our analytics"), `collection_position` (optional positive integer). New cards can be created inline by referencing them with negative ids in `cardEmbed` nodes and supplying their definitions in a top-level `cards` map — see the `document` skill.

For a document to open clean (no spurious "unsaved changes"), each id-bearing node (`paragraph`, `heading`, `codeBlock`, `orderedList`, `bulletList`, `blockquote`, `cardEmbed`, `supportingText`) must carry a unique `_id` — `create`/`update` **validate** this and reject a body where any such node is missing one (mint ids with `mb uuid`). Other node types don't take an `_id`. See the `document` skill (`mb skills get document`) for the full authoring guide.

### `mb document update <id>`

Patch a document. Body is a partial subset of the create shape plus `archived`. Only the keys you send are touched; replacing `document` replaces the whole body.

```sh
cat patch.json | mb document update 1
mb document update 1 --file patch.json
mb document update 1 --body '{"name":"renamed"}'
mb document update 1 --body '{"archived":false}'
```

| Flag            | Description             |
| --------------- | ----------------------- |
| `--body <json>` | Inline JSON body.       |
| `--file <path>` | Path to JSON body file. |

### `mb document copy <id>`

Copy a document into a collection (`POST /api/document/:id/copy`, Metabase v59+). The copy duplicates the cards saved inside the document into the target collection and carries the source body with their embeds pointing at the duplicates. An archived source is not found. Prints the new document.

```sh
mb document copy 1
mb document copy 1 --name "Notes (copy)" --collection-id 4 --json
```

| Flag                        | Description                                             |
| --------------------------- | ------------------------------------------------------- |
| `--name <name>`             | Name for the copy (default: the source name).           |
| `--collection-id <id>`      | Collection to copy into (default: the root collection). |
| `--collection-position <n>` | Pin the copy at this position in the collection.        |

### `mb document archive <id>`

Soft-delete a document by setting `archived: true`. To unarchive use `mb document update <id> --body '{"archived":false}'`.

```sh
mb document archive 1
mb document archive 1 --json
```

## Glossary

The instance-wide list of business terms and their definitions, from `/api/glossary`. Entries are listed on the Glossary pages of Data Studio and the Data Reference and are handed to Metabot as context, so a definition written once shapes every answer that uses the term. Every verb runs on every supported server; a server may restrict writes to admins and data analysts. Terms are unique. There is no get-by-id endpoint — use `list --search`.

### `mb glossary list`

Lists every entry in term order. `--search <text>` keeps the entries whose term or definition contains the text, case-insensitively. Some servers read `%` and `_` in the text as SQL LIKE wildcards rather than literal characters; a blank `--search` is refused.

```sh
mb glossary list
mb glossary list --search churn --json
```

### `mb glossary create`

Create an entry from `--term` and `--definition` together, or from a JSON body that holds exactly those two keys. The flags cannot be combined with `--body` or `--file`, and a body piped on stdin is not read while they are given. A blank or whitespace-only term or definition is refused.

```sh
mb glossary create --term "Churn" --definition "Customers lost in a calendar month"
mb glossary create --body '{"term":"Churn","definition":"Customers lost in a calendar month"}'
mb glossary create --file entry.json
```

| Flag                  | Description                          |
| --------------------- | ------------------------------------ |
| `--term <text>`       | The term (used with `--definition`). |
| `--definition <text>` | The definition (used with `--term`). |
| `--body <json>`       | Inline JSON body.                    |
| `--file <path>`       | Path to JSON body file.              |

### `mb glossary update <id>`

Replace both the term and the definition of an entry. Takes the same flags and body as `create`.

```sh
mb glossary update 3 --term "Churn" --definition "Customers lost in a calendar month"
mb glossary update 3 --body '{"term":"Churn","definition":"Customers lost in a calendar month"}'
```

### `mb glossary delete <id>`

Delete an entry. Prompts for confirmation on a TTY; requires `--yes` otherwise.

```sh
mb glossary delete 3 --yes
```

| Flag    | Description        |
| ------- | ------------------ |
| `--yes` | Skip confirmation. |

## Settings

Read and write Metabase instance settings via `/api/setting`. Listing all settings requires admin privileges; per-key reads/writes additionally enforce per-setting access. Setting values are always JSON — `"main"` is the string `main`, `42` is a number, `null` deletes the override and resets the value to its default.

### `mb setting list`

```sh
mb setting list
mb setting list --json --max-bytes 0
```

Returns a `ListEnvelope` of compact entries (`key`, `value`, `is_env_setting`, `env_name`). Pass `--full` for the full per-row payload (also includes `description` and `default`). The full payload can exceed the default `--max-bytes` cap; pass `--max-bytes 0` to disable the cap.

### `mb setting get <key>`

```sh
mb setting get site-name
mb setting get remote-sync-branch --json
```

Returns `{ key, value }` for a single setting. Settings whose stored value matches the default — or that come from an env var — surface as `value: null`.

### `mb setting set <key> [value]`

Set or delete a setting. The value is parsed strictly as JSON: pass `'"main"'` for the string `main`, `true`/`42` for booleans/numbers, `null` to delete the stored override (resets to default).

```sh
mb setting set remote-sync-branch '"main"'
mb setting set anon-tracking-enabled true
echo '"main"' | mb setting set remote-sync-branch
mb setting set remote-sync-branch --file value.json
mb setting set remote-sync-branch null
```

| Flag            | Description                                                              |
| --------------- | ------------------------------------------------------------------------ |
| `--file <path>` | Read the JSON value from a file (alternative to the positional / stdin). |

Sources are resolved in this order: positional, `--file`, piped stdin. Provide exactly one; an unparseable value or a missing source fails fast with a `ConfigError`.

## Search

### `mb search [query]`

Search Metabase content (cards, dashboards, collections, tables, …). Returns a `ListEnvelope` of compact search results by default; pass `--full` for the full per-row payload.

```sh
mb search orders
mb search --models card,dashboard --limit 10 --json
mb search products --archived
mb search --collection 12 --created-by 3,7 --include-dashboard-questions --json
mb search revenue --search-native-query --include-metadata --full --json
```

| Flag                            | Description                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--models`, `-m`                | Comma-separated model filter: `card,dataset,metric,dashboard,collection,database,table,segment,measure,document,action,transform,indexed-entity`.                                                                                                                                                                                                  |
| `--archived`                    | Include archived items only.                                                                                                                                                                                                                                                                                                                       |
| `--limit`                       | Max results to return (default `20` — `search` is the one list verb with its own default).                                                                                                                                                                                                                                                         |
| `--offset`                      | Where the window starts, applied by the server (default `0`).                                                                                                                                                                                                                                                                                      |
| `--db-id`                       | Restrict to items on a given database id.                                                                                                                                                                                                                                                                                                          |
| `--verified`                    | Only verified content.                                                                                                                                                                                                                                                                                                                             |
| `--collection`                  | Restrict to one collection by id: the collection's own row, its subcollections and the content filed under them. Segments, measures and transforms never match, tables only once published to the Library, and a transforms collection is not searchable at all. Questions saved into a dashboard match only with `--include-dashboard-questions`. |
| `--created-by`                  | Comma-separated user ids; matches items created by any of them. Only kinds that record a creator can match — cards, models, metrics, dashboards, actions, documents, and measures from Metabase 60 — so collections, tables, databases, segments, transforms and indexed entities drop out.                                                        |
| `--search-native-query`         | Also match native query text. Narrows the result to the models that carry a query — cards, models, metrics, actions, transforms — so dashboards, collections and tables drop out.                                                                                                                                                                  |
| `--include-metadata`            | Attach the `result_metadata` of each card, model and metric row. Only `--json` with `--full`, or `--fields` naming `result_metadata`, prints it, so the flag needs one of them.                                                                                                                                                                    |
| `--include-dashboard-questions` | Also match questions saved into a dashboard, which search leaves out by default.                                                                                                                                                                                                                                                                   |

## Git Sync

Drive Metabase Enterprise Remote Sync (`/api/ee/remote-sync`) — import / export Metabase content against a configured git remote, inspect dirty state, and manage branches. All git-sync commands require Metabase v60 or newer, the `remote_sync` premium feature on an active EE token, and superuser credentials.

### `mb git-sync status`

Roll up the current sync state in one call: configured branch, dirty flag, the most recent sync task (or `null` if none has ever run), and the collections marked for sync.

```sh
mb git-sync status
mb git-sync status --json
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
mb git-sync import --merge
```

| Flag                    | Description                                                                                                                                                                                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--branch <name>`, `-b` | Branch to import from (defaults to the `remote-sync-branch` setting). A blank name is refused with exit 2.                                                                                                                                                                                                    |
| `--force`               | Discard local Metabase-side dirty changes before importing (LOSSY).                                                                                                                                                                                                                                           |
| `--merge`               | Keep un-pushed local changes and fold the remote's in by a three-way merge; entities changed on both sides, or no merge base (a rewritten remote history, or an instance that has never synced), end the task in `conflict` without touching local state. Not with `--force`. Requires Metabase v63 or newer. |
| `--wait` / `--no-wait`  | Poll until the task reaches a terminal status (default: wait).                                                                                                                                                                                                                                                |
| `--timeout <ms>`        | Polling timeout in ms (default 600000). Used with `--wait`.                                                                                                                                                                                                                                                   |
| `--interval <ms>`       | Polling interval in ms (default 2000). Used with `--wait`.                                                                                                                                                                                                                                                    |

On Metabase v63 and newer the import also asserts which branch git-sync tracks, read from the session properties just before the request (an environment-set `MB_REMOTE_SYNC_BRANCH` included). When no branch is tracked the command refuses with exit 2; when the caller is not an admin, so the setting is not readable, it refuses with exit 2 rather than reading it as unset. A task that ends in `conflict` lists the conflicting entities in its text output and error. The server then counts the remote commit that task saw as synced, so a retry, `--merge` included, no longer sees the remote's changes: resolve a conflict with `--force` on the side to keep, or `create-branch` then `export`, never with a retry.

### `mb git-sync export`

Export Metabase changes back to the configured git remote (Metabase → repo). Auto-polls by default. The export targets the branch git-sync tracks; to push to a new branch, `stash` or `create-branch` first. When the remote has moved past the last sync, a plain export ends in a `conflict` task on Metabase v63 and newer, and is refused with a 400 on older servers. Such a task names the divergence in its text output and error, and leaves the remote's commit counted as synced, as an import conflict does: never answer it with a retry.

```sh
mb git-sync export -m "update dashboards"
mb git-sync export --merge -m "update dashboards"
mb git-sync export --branch main --json
mb git-sync export --no-wait
```

| Flag                    | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--branch <name>`, `-b` | Branch to export to (defaults to the `remote-sync-branch` setting). On Metabase v63 and newer it must be the branch git-sync tracks (the server answers 409 with the current one), and with no `--branch` the command refuses with exit 2 when no branch is tracked or the setting is not readable. Older servers export to the named branch and switch git-sync to it, refusing with 400 when that branch's tip is not the last synced commit unless `--force` is given. A blank name is refused with exit 2. |
| `--message <msg>`, `-m` | Commit message for the export.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `--force`               | Force-push / overwrite the remote branch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `--merge`               | When the remote moved past the last sync, fold its changes in by a three-way merge instead of ending in a `conflict` task; entities changed on both sides still end it in `conflict`, writing nothing. Not with `--force`. Requires Metabase v63 or newer.                                                                                                                                                                                                                                                     |
| `--wait` / `--no-wait`  | Poll until the task reaches a terminal status (default: wait).                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `--timeout <ms>`        | Polling timeout in ms (default 600000). Used with `--wait`.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `--interval <ms>`       | Polling interval in ms (default 2000). Used with `--wait`.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### `mb git-sync export-preflight`

Preview what an export would do against the live remote branch, without writing anything: whether the remote has moved past the last sync, whether a three-way merge would apply cleanly, which entities would conflict, what a merge would fold in, and what a force push would discard. Requires Metabase v63 or newer.

```sh
mb git-sync export-preflight
mb git-sync export-preflight --branch main --json
```

| Flag                    | Description                                                                                                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--branch <name>`, `-b` | Branch to preview against (defaults to the `remote-sync-branch` setting). It must be the branch git-sync tracks; the server answers 409 with the current one. A blank name is refused with exit 2. |

The result is the server's `{ has_changes, clean, conflicts, summary: { added, updated, removed }, force_push_casualties: { deleted, overwritten }, reason }`. `reason` is `"history-rewritten"` when the remote was force-pushed or rebased so no merge base exists (a merge is impossible; only `export --force` can push), otherwise `null`. When `clean` is true, `export --merge` applies the merge; when it is false, `create-branch <name>` then `export` pushes Metabase's state to a new branch and leaves the old one untouched. `has_changes` is also false after a task that ended in `conflict`, which the server counts as synced. `force_push_casualties` is empty when nothing has been synced yet, although a forced export then replaces the remote's managed directories wholesale. Text output is one headline for the branch, then the conflicts, the merge summary and the casualties, each only when there is something to list. When no `--branch` is passed and no branch is tracked, or the setting is not readable (the caller is not an admin), the command refuses with exit 2 before contacting the remote. The tracked branch is read from the session properties, so one set by `MB_REMOTE_SYNC_BRANCH` counts.

### `mb git-sync stash`

Export the current Metabase state to a NEW branch on the remote and switch sync to it. Requires `remote-sync-type` to be `read-write`.

```sh
mb git-sync stash --new-branch wip
mb git-sync stash --new-branch wip -m "work in progress" --json
```

| Flag                    | Description                                                    |
| ----------------------- | -------------------------------------------------------------- |
| `--new-branch <name>`   | Required. Branch to create and export to.                      |
| `--message <msg>`, `-m` | Commit message (default `Stashed from mb CLI`).                |
| `--wait` / `--no-wait`  | Poll until the task reaches a terminal status (default: wait). |
| `--timeout <ms>`        | Polling timeout in ms. Used with `--wait`.                     |
| `--interval <ms>`       | Polling interval in ms. Used with `--wait`.                    |

### `mb git-sync branches`

List branches available on the configured git remote.

```sh
mb git-sync branches --json
```

### `mb git-sync create-branch <name>`

Create a new branch on the git remote and switch sync to it. The branch starts at the last synced commit, or at the tracked branch's tip when nothing has synced yet; nothing is exported until the next `git-sync export`.

```sh
mb git-sync create-branch feat/dashboards
mb git-sync create-branch feat/x --json
```

### `mb git-sync add-collection <id>`

Mark a collection as git-synced. The toggle cascades to every descendant by `location` prefix, so flagging a parent flags the whole subtree. Returns `{ success, task_id? }`; `task_id` only appears when the toggle triggers a follow-up task (e.g. a finalization import after switching to read-only mode).

```sh
mb git-sync add-collection 12
mb git-sync add-collection 12 --json --profile prod
```

The server rejects toggles while `remote-sync-type` is `read-only` (the install default). Switch first with `mb setting set remote-sync-type '"read-write"'`.

### `mb git-sync remove-collection <id>`

Unmark a collection as git-synced. Same cascade and same `read-only` precondition as `add-collection`.

```sh
mb git-sync remove-collection 12
mb git-sync remove-collection 12 --json --profile prod
```

## Instance setup

Bootstrapping a fresh, not-yet-configured Metabase instance.

### `mb setup`

Complete the initial setup wizard (`POST /api/setup`). The body must include the setup token, the default user, and the `prefs` block (with `site_name`).

```sh
cat setup.json | mb setup
mb setup --file setup.json
mb setup --body '{"token":"<setup-token>","user":{"email":"a@b.c","password":"..."},"prefs":{"site_name":"Acme"}}'
```

| Flag            | Description             |
| --------------- | ----------------------- |
| `--body <json>` | Inline JSON body.       |
| `--file <path>` | Path to JSON body file. |

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

Run an MBQL 5 query with built-in schema validation, or ask the server what it would do with one. Modes — discover the schema (`--print-schema`), check and compile without running (`--dry-run`), run, compile to native (`--compile`), list what the query touches (`--metadata`), stream the rows as a download (`--export-format`). `--dry-run`, `--compile`, `--metadata` and `--export-format` are mutually exclusive, and `--print-schema` takes none of them.

MBQL 5 bodies use numeric IDs (`database: 1`, `source-table: 7`) and POST to `/api/dataset`. The bundled query schema is synced from `@metabase/representations`; `id.yaml` is overridden to require positive integers for every ID `$def`.

```sh
mb query --print-schema                     # JSON Schema bundle
cat q.json | mb query --dry-run             # check + compile on the server, no run
mb query --file q.json
mb query --file q.json --skip-validate      # bypass pre-flight; let server reject
mb query --file q.json --compile            # the SQL the server compiles it to, prettified
mb query --file q.json --compile --no-pretty --format text   # one line, bare, for $(…)
mb query --file q.json --metadata --json    # databases, tables, fields, snippets it touches
mb query --file q.json --export-format csv > rows.csv
mb query --file pivot.json --export-format xlsx --pivot-results \
  --visualization-settings '{"pivot_table.column_split":{"rows":["category"],"columns":["status"],"values":["count"]}}' > pivot.xlsx
```

Body sources: `--file`, `--body`, or stdin (exactly one). Body is JSON.

| Flag                              | Description                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--print-schema`                  | Emit the bundled MBQL 5 query JSON Schema and exit; no body required. Refused beside `--dry-run`, `--compile`, `--metadata` or `--export-format`.                                                                                                                                                                                                    |
| `--dry-run`                       | Check the body and compile it on the server without running it; prints `{ ok, errors, sql }`.                                                                                                                                                                                                                                                        |
| `--compile`                       | Print the native query the server compiles the body to (`{ query, params }`) instead of running it. Text output is the bare query. Needs native query permission on the body's database.                                                                                                                                                             |
| `--pretty` / `--no-pretty`        | With `--compile`: format the native query for reading (default: on, as on the server). `--no-pretty` compiles to one line. Either is refused without `--compile`.                                                                                                                                                                                    |
| `--metadata`                      | Print the databases, tables, fields and snippets the body references. The FK targets of the source tables ride along; compact by default.                                                                                                                                                                                                            |
| `--export-format <fmt>`           | Stream the rows as a download instead of the JSON envelope. One of `csv`, `json`, `xlsx`.                                                                                                                                                                                                                                                            |
| `--visualization-settings <json>` | Streamed exports only: the visualization settings object an ad-hoc query has no card to take from. Its `column_settings` shape `--format-rows`; its `pivot_table.column_split` is the layout `--pivot-results` needs. Refused without `--export-format`.                                                                                             |
| `--format-rows`                   | Streamed exports only: format values as Metabase displays them, `--visualization-settings` column settings included (default `false`). Refused without `--export-format`.                                                                                                                                                                            |
| `--pivot-results`                 | With `--export-format csv` or `xlsx`: run the body as a pivot query and lay its rows out as the pivot `--visualization-settings` describes, with subtotals (default `false`). Refused without a `pivot_table.column_split` in `--visualization-settings`, and when the server has pivoted exports turned off (the `enable-pivoted-exports` setting). |
| `--csv-include-bom`               | With `--export-format csv`: open the file with a UTF-8 byte order mark, so Excel reads it as UTF-8 (default `false`). Metabase v63+.                                                                                                                                                                                                                 |
| `--skip-validate`                 | Skip the local MBQL 5 pre-flight and let the server be the authority. Mutually exclusive with `--dry-run`.                                                                                                                                                                                                                                           |

Any non-MBQL 5 body skips pre-flight automatically — legacy MBQL 4 (`{ "type": "query", "database": N, "query": { "source-table": T, ... } }`), legacy native (`{ "type": "native", "database": N, "native": { "query": "..." } }`), or any other shape that doesn't carry `"lib/type": "mbql/query"`. The bundled schema only models MBQL 5; `/api/dataset` normalizes the rest server-side via `lib-be/normalize-query` (the same normalizer that backs `card create` / `transform create`), so behavior is symmetric across endpoints. `--dry-run` on a non-MBQL 5 body goes straight to the server compile. The double-wrap footgun — an MBQL 5 query nested inside a `{type:"query", query:…}` envelope — is still rejected with a `ConfigError` before send. The pre-flight applies to every server-bound mode: `--compile`, `--metadata` and `--export-format` refuse an invalid MBQL 5 body the same way a run does.

`--skip-validate` is an escape hatch when the bundled schema disagrees with what the server actually accepts (drift, false negative, edge case) for MBQL 5 bodies. Validation is skipped entirely and the body is sent as-is. Mutually exclusive with `--dry-run`, whose point is the local check.

Exit codes:

- `0` — the query ran, with `--dry-run` or `--compile` compiled, or with `--metadata` answered.
- `2` — the local check, or with `--dry-run` the server compile, rejected the body; malformed body (including one without `lib/type` or `type`, in every mode), or `ConfigError`.
- `1` — server-side error after a valid pre-flight (network, HTTP 4xx/5xx), or with `--dry-run` or `--compile` a compile that could not run (no native query permission on the database, no access to a table or card the query reads, server unreachable).

Output by mode:

- `--print-schema` — `{ schema, defs: { "id.yaml", "parameter.yaml", "ref.yaml", "temporal_bucketing.yaml" } }`. The query schema's `$ref`s point into the `defs` namespace by file path; an agent can either feed the bundle directly into Ajv (`addSchema(defs["id.yaml"], "id.yaml")` etc., then `compile(schema)`) or read it as documentation.
- `--dry-run` — `{ ok: boolean, errors: { path: string, message: string }[], sql: string | null }`. The local check runs first; when it passes, `POST /api/dataset/native` compiles the query without running it on the warehouse. A local error's `path` is a JSON Pointer into the body and `message` the Ajv error string; a server rejection (HTTP 400, or 500 from a reference it cannot resolve) is one error with `path: ""` and the server's message. `sql` is the compiled native query, `null` when it did not compile.
- Local check failure (no `--dry-run`) — `{ ok, errors }` on stdout, exit 2, no request made.
- Run success — the streamed `CardQueryResult`.
- `--compile` — `{ query, params }`, plus `collection` for a document database; a server that drops the key from its answer (Metabase v59–v62) reports `collection: null`. The server inlines parameters into the query, so `params` is `null` for a SQL driver. It is the query as compiled, not as a run executes it: a run also caps an unaggregated query at the server's row limit, which the compile leaves out. Compiling needs native query permission on the database and access to every table and card the query reads; without them the server refuses with 403 (exit 1). Text output is the query alone; a document driver's stage list prints as JSON.
- `--metadata` — `{ databases, tables, fields, snippets }`. `tables` includes the source table and the tables its foreign keys point at; a card used as a source appears as a virtual table with a `card__<id>` id. `fields` are the fields native template tags (field filters) and snippets point at; an MBQL body's own columns sit inside its tables. Compact by default (names, ids, types); `--full` carries every hydrated field, which exceeds the default `--max-bytes` for most tables.
- `--export-format` — the export bytes, straight to stdout, capped at the server's download row limit. `--full`, `--fields` and `--max-bytes` are refused, since they shape only the JSON output; `--json` and `--format` still pick the shape of an error.

### MBQL 5 pre-flight in `card create`/`update`, `transform create`/`update`, `measure create`/`update`, and `segment create`/`update`

When the embedded query (`card.dataset_query`, `transform.source.query` for `source.type: "query"`, or `measure.definition` / `segment.definition`) is MBQL 5 (`lib/type: "mbql/query"`), it is pre-flight-validated against the same schema as `mb query`. Validation failure: `{ ok, errors }` envelope on stdout, exit 2, request not made. MBQL 4 (legacy) bodies and Python transform sources skip validation — they're still accepted by the server and we don't ship a schema for them.

Pass `--skip-validate` to bypass the pre-flight on any of `card create`, `card update`, `transform create`, `transform update`, `measure create`, `measure update`, `segment create`, or `segment update` — the body is sent as-is and the server is the authority. Same escape hatch as on `mb query`; use only when the bundled schema disagrees with what the server actually accepts.

Agent discovery path: `mb <command> --help --json` lists a command's args, JSON-body input schema, and output schema; the description for `card create`/`update`, `transform create`/`update`, `measure create`/`update`, and `segment create`/`update` references `mb query --print-schema` so an agent can fetch the validating schema directly.

The bundled query schema is synced from a pinned `@metabase/representations` release via `bun run sync:representations`; CI guards against drift.

### Card-reference pre-flight in `dashboard create` / `dashboard update`

Before either command sends anything, every positive `card_id` referenced from the body's `dashcards` array is checked against `GET /api/card/:id` in parallel (de-duplicated per id). Cards that don't exist, are archived, or aren't readable fail pre-flight: the CLI writes a `{ ok: false, errors: [{ path, message }] }` envelope to stdout (one entry per offending dashcard, `path` is a JSON pointer like `/dashcards/3/card_id`) and exits **2** with `dashboard card-reference pre-flight failed: N error(s) — fix the dashcard card_id values listed above` on stderr. No dashboard is created or modified on a pre-flight miss — this is the contract that prevents orphan dashboards when a stale spec references an archived or missing card.

There is no `--skip-validate` escape hatch here. The pre-flight queries live server state (no bundled schema to drift from), so the only legitimate path on a pre-flight miss is to fix the input.

If the chained `PUT /api/dashboard/:id` fails _after_ the create has already inserted the row (rare with pre-flight in place, but possible on a permission / 5xx / network failure mid-flight), the user-facing error is rewritten to `dashboard <id> created but follow-up PUT /api/dashboard/<id> failed: <reason>; dashcards not applied`, so the caller knows the orphan exists. Recovery: `dashboard update <id> --body '{"dashcards":[...]}'` to retry the dashcards, or `dashboard update <id> --body '{"archived":true}'` to archive the orphan.

## UUIDs

### `mb uuid`

Mint UUID v4 strings (Node `crypto.randomUUID`) for the values that must be a UUID: the `lib/uuid` of an aggregation that an MBQL aggregation ref points at, and a document node's `_id`. The MBQL pre-flight rejects a hand-written placeholder (`a1`, `uuid-1`) in a `lib/uuid`.

```sh
mb uuid                          # one UUID
mb uuid --count 5                # five UUIDs, one per line (text mode in a TTY, JSON when piped)
mb uuid --count 5 --json         # explicit JSON: ["…", "…", "…", "…", "…"]
mb uuid --count 5 --format text  # explicit text: one UUID per line
U=$(mb uuid --format text)       # capture one bare UUID in a shell variable
```

Output: text mode prints one UUID per line; JSON mode prints a `string[]`. Default behavior follows the standard `--format auto` rule — JSON when stdout is a pipe, text when it's a TTY.

`--count` accepts integers `1` through `10000`; outside that range exits 2 with a `ConfigError`.

Exit codes: `0` success, `2` invalid `--count`.

## Upgrade

### `mb upgrade`

Self-update the CLI. Fetches the latest published version from the npm registry's `/-/package/<pkg>/dist-tags` endpoint, detects how the binary was installed (npm-global / npm-local / npx / dev / unknown — for the global case, also which package manager: npm, pnpm, yarn, or bun), and either runs the matching install command (for npm-style globals, after confirmation) or prints the exact command to run by hand.

```sh
mb upgrade                 # interactive: check + confirm + run for global installs
mb upgrade --check         # print status only, never install
mb upgrade --check --json  # structured plan for agents
mb upgrade --yes           # skip the confirmation prompt
mb upgrade --to 0.1.2      # pin a specific version (also valid for downgrades)
```

Flags:

- `--check` — print the upgrade plan without installing.
- `--yes` / `-y` — skip the confirmation prompt; only meaningful when the install method is auto-installable.
- `--to <version>` — target a specific semver instead of the registry `latest`. Useful for pinning or rolling back.
- `--registry <url>` — override the npm registry (default `https://registry.npmjs.org`). The same URL the CLI hits to fetch dist-tags; the actual install always goes through your local `npm` / `pnpm` / `yarn` / `bun` which use their own configured registry.

JSON output (UpgradeStatus):

```json
{
  "packageName": "@metabase/cli",
  "currentVersion": "0.1.2",
  "latestVersion": "0.1.3",
  "targetVersion": "0.1.3",
  "updateAvailable": true,
  "changeRequired": true,
  "installMethod": "npm-global",
  "packageManager": "npm",
  "binaryPath": "/usr/local/lib/node_modules/@metabase/cli/dist/cli.mjs",
  "command": {
    "argv": ["npm", "install", "-g", "@metabase/cli@0.1.3"],
    "display": "npm install -g @metabase/cli@0.1.3"
  },
  "canAutoInstall": true
}
```

Auto-install happens only when `installMethod === "npm-global"`; everything else (local installs, npx, dev checkouts) prints the upgrade command and exits. In non-TTY runs without `--yes`, the command never prompts.

Exit codes: `0` success (including up-to-date / printed-instructions), `1` registry or install failure, `2` invalid `--to` value, `130` user cancelled the prompt.

## Skills

The CLI ships with bundled agent skills (Claude Code / `npx skills add` compatible) that document `mb` itself. Content is served at runtime from the installed CLI version, so the instructions an agent fetches always match the binary it's about to run — no drift between a separately-installed skill copy and the CLI.

```sh
mb skills list                              # bundled skills the profile's server can use (table or JSON)
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

Skills describe the newest Metabase plainly and declare what they rely on: a skill's frontmatter carries `requires: [<feature>, …]` (names from the client's feature table, e.g. `transforms`, `remoteSync`), and a passage inside a skill or one of its references sits between `<!-- requires: <feature>, … -->` and `<!-- /requires -->` markers, each on its own line. `skills list` and `skills get` read the profile's cached server probe (`--profile` respected; no request is made) and resolve both against it: a skill whose features the server lacks is left out and reported in the JSON envelope's `unavailable` array as `{ name, failure }`, where `failure` is the same `{ reason, detail, feature, since, tokenFeature, serverVersion }` a refused command carries; a met section keeps its text and loses its markers; an unmet one is removed. Text mode reports each skipped skill on stderr. Without a cached probe nothing is filtered, `unavailable` is `null`, the markers are printed as written, and text mode says why on stderr: no such profile, a profile never probed, or no probe for the URL `MB_URL` points at. `--unfiltered` bypasses the filter on both commands and prints the selected skills as written; on `get`, `--all` selects every non-hidden skill and combines with either. A marker inside a fenced code block is text. An unknown feature name, an unbalanced marker pair, or a marker between table rows is a `ConfigError` on every read, so a typo fails the gate rather than hiding a skill.

Bundled skills:

| Name            | Use                                                                                     |
| --------------- | --------------------------------------------------------------------------------------- |
| `core`          | Top-level guide: auth, flag conventions, output flags, body input, every command group  |
| `data-workflow` | Front-door router for the whole journey (raw → clean tables → definitions → dashboards) |
| `mbql`          | Authoring and fixing MBQL 5 query bodies                                                |
| `native-sql`    | Native SQL query bodies: template tags, field filters, snippets, card references        |
| `visualization` | Choosing a card's `display` and authoring `visualization_settings`                      |
| `dashboard`     | Interactive dashboards: filter wiring, linked filters, cross-filtering, click behavior  |
| `metadata`      | Semantic types, FK targets, dropdown behavior, and the features each unlocks            |
| `transform`     | Authoring and running transforms (native SQL + MBQL 5), iteration, run inspection       |
| `notification`  | Scheduled delivery: question alerts and dashboard subscriptions                         |
| `document`      | Authoring document bodies: the TipTap JSON tree, embedding cards, entity links          |
| `git-sync`      | Round-tripping Metabase content to/from a git remote                                    |

Discovery surfaces:

- **Claude Code plugin marketplace**: `.claude-plugin/marketplace.json` declares a `metabase-cli` plugin pointing at the in-repo discovery stub. Users install with `/plugin marketplace add metabase/mb-cli` then `/plugin install metabase-cli@metabase`. The manifest lives at the repo root and is served from GitHub, not from the npm tarball: its `source: "./packages/cli"` is resolved relative to the repo checkout, so a copy inside the published package would point at nothing. `files` in `packages/cli/package.json` therefore omits `.claude-plugin` by design.
- **`npx skills add`**: the same stub at `packages/cli/skills/metabase-cli/SKILL.md` is picked up by `npx skills add metabase/mb-cli`. The stub is intentionally minimal — it redirects the agent at `mb skills get core` so the real workflow content always comes from the installed CLI version.

Exit codes: `0` success (a skill the server cannot use is reported, not refused), `2` `ConfigError` (missing name, unknown name, `MB_SKILLS_DIR` not a directory, an unknown feature in `requires`, an unbalanced section marker), `1` unexpected I/O.

## Environment variables

| Variable                 | Effect                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MB_URL`                 | Default URL for `auth login` and config resolution.                                                                                                                       |
| `MB_API_KEY`             | Default API key (makes `auth login` non-interactive, skipping the browser flow; not stored).                                                                              |
| `MB_PROFILE`             | Default profile when `--profile` is omitted. Falls back to `default`.                                                                                                     |
| `MB_VERBOSE`             | When set to `1`, prints structured developer-detail JSON to stderr on failure.                                                                                            |
| `MB_CLI_SKIP_PREFLIGHT`  | When set to `1`, bypasses the per-command server version / token-feature preflight check. Escape hatch for patched Metabase builds; can mask real compatibility problems. |
| `MB_CLI_DISABLE_KEYRING` | When set to `1`, skips the OS keychain and stores credentials as plaintext in the profiles file.                                                                          |
| `MB_SKILLS_DIR`          | Override the directory `mb skills` scans (dev/test only; defaults to the CLI's bundled `skills` + `skill-data` trees).                                                    |

The former `METABASE_`-prefixed names (`METABASE_URL`, `METABASE_API_KEY`, `METABASE_PROFILE`, `METABASE_VERBOSE`, `METABASE_CLI_SKIP_PREFLIGHT`, `METABASE_CLI_DISABLE_KEYRING`) are deprecated but still honored; the CLI prints a one-line warning to stderr when it falls back to one. Switch to the `MB_`-prefixed names.

## Agent integration

### `--help --json`

Every node of the command tree answers `--help --json` with machine-readable help, mirroring what text help shows at that level:

- A leaf command emits its full entry — name, description, `details`, examples, citty args with types/defaults/enums, `requires` (the client methods the command calls and the server features they need), and the input and output Zod schemas rendered as JSON Schema (`inputSchema` is the exact validator `readBody` enforces on the JSON body, `null` for commands that take none).
- A command group (and the root) emits `{ description, skills, commands }` — its own sentence (`null` when it declares none), its own agent-skill pointers, and a flat `commands: [{ command, description }]` index of every leaf in its subtree, with full-path names.

```sh
mb --help --json | jq -r '.commands[].command'    # every command
mb card query --help --json | jq .outputSchema    # one command's output schema
mb card create --help --json | jq .inputSchema    # the JSON-body contract it validates
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

`bin/mb-dev` runs the CLI straight from source against a scratch config directory, so a
dev run never touches your real profiles or the OS keychain.

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
