# metabase-cli

Command-line client for Metabase. Authenticates against an instance with an API key and stores it securely on your machine.

## Install

```sh
npm install -g @metabase/cli
mb --help
```

Or build from source:

```sh
bun install
bun run build
node dist/cli.mjs --help
```

The binary is `mb`. Examples below use that name.

## Quick start

```sh
mb auth login --url https://metabase.example.com
mb auth status
```

## Authentication

Credentials are stored per-profile. The default profile is named `default`. Use `--profile <name>` to manage additional profiles.

### `mb auth login`

Save credentials for a profile.

| Flag                | Description                                                |
| ------------------- | ---------------------------------------------------------- |
| `--url <url>`       | Metabase URL. Falls back to `METABASE_URL`, then prompts.  |
| `--api-key <value>` | API key. Visible in shell history — pipe on stdin instead. |
| `--profile <name>`  | Profile to write to (default: `default`).                  |
| `--skip-verify`     | Save without contacting the server.                        |

Resolution order for the API key: `--api-key` → piped stdin → `METABASE_API_KEY` → interactive prompt. Stdin is auto-detected when not a TTY.

```sh
echo "$MB_KEY" | mb auth login --url https://m.example.com
mb auth login --url https://m.example.com < key.txt
```

### `mb auth status`

Show whether a profile is authenticated.

```sh
mb auth status
mb auth status --json
mb auth status --profile staging
```

| Flag               | Description                              |
| ------------------ | ---------------------------------------- |
| `--profile <name>` | Profile to inspect (default: `default`). |
| `--json`           | Emit JSON. Auto-enabled on non-TTY.      |

### `mb auth list`

List configured authentication profiles. The index is maintained at `<configDir>/profiles.json` and updated on every `auth login` / `auth logout`. Profiles whose URL/API key were stored in the OS keychain before the index existed are picked up by a one-time backfill from `credentials.json`; profiles that exist only in the keyring (no entry in `credentials.json`) appear after the next `auth login` or `auth logout` against them.

```sh
mb auth list
mb auth list --json
```

| Flag     | Description                         |
| -------- | ----------------------------------- |
| `--json` | Emit JSON. Auto-enabled on non-TTY. |

### `mb auth logout`

Clear stored credentials for a profile.

```sh
mb auth logout --yes
mb auth logout --profile staging --yes
```

| Flag               | Description                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `--profile <name>` | Profile to clear (default: `default`).                                                                                            |
| `--yes`            | Skip the interactive confirmation prompt. In non-TTY contexts the prompt is skipped automatically (kubectl/gh/docker convention). |

## License

Manage the Metabase Enterprise license token.

### `mb license set [token]`

Store a license token. Resolution order: positional → piped stdin → `METABASE_LICENSE_TOKEN` → interactive prompt. Stdin is auto-detected when not a TTY.

Common output flags (`--json`, `--format`, `--detail`, `--fields`, `--max-bytes`) are accepted; the result payload is rendered through the standard output layer.

```sh
echo "$MB_LICENSE" | mb license set
mb license set < token.txt
```

### `mb license status`

Show whether a license is stored. Does not reveal the value.

```sh
mb license status
mb license status --json
```

| Flag     | Description                         |
| -------- | ----------------------------------- |
| `--json` | Emit JSON. Auto-enabled on non-TTY. |

### `mb license remove`

Clear the stored license.

```sh
mb license remove --yes
```

| Flag    | Description                                                                                                                       |
| ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `--yes` | Skip the interactive confirmation prompt. In non-TTY contexts the prompt is skipped automatically (kubectl/gh/docker convention). |

Common output flags (`--json`, `--format`, `--detail`, `--fields`, `--max-bytes`) are accepted; the result payload is rendered through the standard output layer.

## Transforms

CRUD on `/api/transform`. Bodies for `create` / `update` are JSON; resolution order: `--body` → `--file` → piped stdin (auto-detected when stdin is not a TTY).

### `mb transform list`

```sh
mb transform list
mb transform list --json
```

### `mb transform get <id>`

```sh
mb transform get 1 --json
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

Trigger a manual run. Returns `{message, run_id}` and exits immediately. Pass `--wait` to poll until the run reaches a terminal status (`succeeded`, `failed`, `timeout`, `canceled`); the `final` field on the result holds the polled run state, and the command exits 1 if the final status is anything but `succeeded`.

```sh
mb transform run 1
mb transform run 1 --wait --json
```

| Flag              | Description                                                 |
| ----------------- | ----------------------------------------------------------- |
| `--wait`          | Poll until the run reaches a terminal status.               |
| `--timeout <ms>`  | Polling timeout in ms (default 600000). Used with `--wait`. |
| `--interval <ms>` | Polling interval in ms (default 2000). Used with `--wait`.  |

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

List recent transform runs across all transforms, or filter to one. Drains all pages by default; pass `--limit` to cap.

```sh
mb transform runs
mb transform runs --transform-id 1 --json
mb transform runs --limit 10 --json
```

| Flag                  | Description                                         |
| --------------------- | --------------------------------------------------- |
| `--transform-id <id>` | Filter to runs of a single transform id.            |
| `--limit <n>`         | Cap total runs returned (default: drain all pages). |

## Transform jobs

CRUD on `/api/transform-job`. Bodies for `create` / `update` follow the same `--body` / `--file` / stdin pattern as transforms.

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

## Databases

Read warehouse metadata from `/api/database`. The `db` group exposes the full database list, the per-database record, schema and table inspection, the two manual-sync triggers, and (rarely useful) full-warehouse rollup endpoints.

`db` is aliased to `database`.

> **Agent traversal:** prefer the granular path — `db list` → `db schemas <db-id>` → `db schema-tables <db-id> <schema>` → `table get <table-id> --include fields`. On a real warehouse (dozens of schemas, hundreds of tables, dozens of fields per table) the rollup commands (`db metadata`, `db get --include tables.fields`, `db list --include tables`) return megabytes of JSON and exhaust the agent context. Reach for them only on small/dev warehouses where you know the size up front.

### `mb db list`

```sh
mb db list
mb db list --json
mb db list --saved --json
mb db list --include tables --full --json   # rollup: every db with its full table list
```

| Flag                | Description                                                                                                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--include <which>` | Hydrate related entities. Currently only `tables` is supported (each database is returned with its `tables`). On real warehouses this returns hundreds of table records per db — use the granular traversal instead. |
| `--saved`           | Include the Saved Questions virtual database in the list. The virtual db has id `-1337` and no `engine`.                                                                                                             |

### `mb db get <id>`

```sh
mb db get 1
mb db get 1 --json
mb db get 1 --include tables --full --json          # rollup: db + every table (compact)
mb db get 1 --include tables.fields --full --json   # rollup: db + every table + every field
```

| Flag                | Description                                                                                                                                                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--include <which>` | Hydrate related entities. One of `tables` or `tables.fields`. `tables.fields` returns every column of every table in the database in one response — only safe on small/dev warehouses. For a real warehouse use `db schemas` → `db schema-tables` → `table get --include fields`. |

### `mb db metadata <id>`

Equivalent to `GET /api/database/:id/metadata`: a single database with all its tables and fields rolled up in one response. This is the largest read in the `db` group — on a real warehouse the response will exceed the agent context. Use only when you know the database is small (a seeded dev instance, a sample db, a freshly-bootstrapped test fixture). For agent-driven introspection on a real warehouse, walk `db schemas` → `db schema-tables` → `table get --include fields` instead.

```sh
mb db metadata 1 --json --full --max-bytes 0
```

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

Trigger a manual schema sync (`POST /api/database/:id/sync_schema`). Returns `{ id, status: "ok" }` once the sync has been queued; the actual work happens asynchronously on the server.

```sh
mb db sync-schema 1
mb db sync-schema 1 --json
```

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

Returns the basic table record (no fields). Pass `--include fields` to route through `/api/table/:id/query_metadata` so the response carries the table's columns compact-projected as `fields` — this is the default agent path for field introspection. Use `mb table fields <id>` if you only want the fields as a list envelope, or `mb table metadata <id>` when you also need FKs and dimensions hydrated.

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

### `mb table metadata <id>`

`GET /api/table/:id/query_metadata`: the table with its fields, FKs, dimensions, segments, and measures all hydrated. Heavier than `table get --include fields` — reach for it only when you actually need the FK / dimension / segment / measure data.

```sh
mb table metadata 42 --json --full --max-bytes 0
```

### `mb table update <id>`

Patch a table (`PUT /api/table/:id`). Body fields: `display_name`, `description`, `caveats`, `points_of_interest`, `entity_type`, `visibility_type`, `field_order`, `show_in_getting_started`. Pass the body via `--body`, `--file`, or stdin (exactly one).

```sh
mb table update 42 --body '{"display_name":"Customers"}'
mb table update 42 --file patch.json
echo '{"description":"Customer dimension"}' | mb table update 42
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

### `mb field update <id>`

Patch a field (`PUT /api/field/:id`). Body fields: `display_name`, `description`, `caveats`, `points_of_interest`, `semantic_type`, `coercion_strategy`, `fk_target_field_id`, `visibility_type`, `has_field_values`, `settings`, `nfc_path`, `json_unfolding`. Pass the body via `--body`, `--file`, or stdin.

```sh
mb field update 100 --body '{"description":"customer email","semantic_type":"type/Email"}'
mb field update 100 --file patch.json
```

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
mb card get 1 --json --detail full
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

### `mb dashboard create`

The body accepts the same dashboard-level fields as the underlying `POST /api/dashboard` (`name`, `description`, `parameters`, `cache_ttl`, `collection_id`, `collection_position`). It also accepts optional `dashcards` and `tabs`: when either is present, the CLI chains a `PUT /api/dashboard/:id` after the create and returns the updated dashboard with its dashcards/tabs applied. Use a negative `id` on a dashcard to indicate one the server should newly create.

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

Patch a dashboard. To edit the dashcard set, send the entire `dashcards` array — IDs not in the array get deleted, and a negative `id` indicates a new dashcard the server should create.

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

CRUD on `/api/measure`. A measure is a saved MBQL aggregation (a single `:aggregation` clause) tied to a table — referenced from cards and metrics to share a reusable computation. Mutating endpoints require a `revision_message` for the audit log.

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

List the cards, dashboards, sub-collections, and other content stored inside a collection. The CLI drains all pages of `/api/collection/:id/items`; pass `--limit` to cap the result. `<id>` accepts the same forms as `collection get` — including `root` for top-level content (items there have `collection_id: null`).

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
| `--limit <n>`            | Cap total items returned. Default: drain all pages.                                                                |

### `mb collection tree`

Fetch the full collection hierarchy as a nested tree. Output is always JSON — the recursive structure does not render meaningfully as a key/value table.

```sh
mb collection tree
mb collection tree --json
```

### `mb collection create`

Create a collection from a JSON spec. The body accepts the same fields as `POST /api/collection`: `name` (required), `description`, `parent_id` (omit or `null` for the root), `namespace`, and `authority_level`.

```sh
cat collection.json | mb collection create
mb collection create --file collection.json
mb collection create --body '{"name":"My Collection","parent_id":4}'
```

| Flag            | Description                                         |
| --------------- | --------------------------------------------------- |
| `--body <json>` | Inline JSON body.                                   |
| `--file <path>` | Path to JSON body file. Use `-` to read from stdin. |

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

Search Metabase content (cards, dashboards, collections, tables, …). Returns a `ListEnvelope` of compact search results by default; pass `--detail full` for the full per-row payload.

```sh
mb search orders
mb search --models card,dashboard --limit 10 --json
mb search products --archived
```

| Flag             | Description                                                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--models`, `-m` | Comma-separated model filter: `card,dataset,metric,dashboard,collection,database,table,segment,measure,snippet,document,action,transform,indexed-entity`. |
| `--archived`     | Include archived items only.                                                                                                                              |
| `--limit`        | Max results to return (default `20`).                                                                                                                     |
| `--table-db-id`  | Restrict to items on a given database id.                                                                                                                 |
| `--verified`     | Only verified content.                                                                                                                                    |

## Git Sync

Drive Metabase Enterprise Remote Sync (`/api/ee/remote-sync`) — import / export Metabase content against a configured git remote, inspect dirty state, and manage branches. All git-sync commands require an active EE token and superuser credentials.

### `mb git-sync status`

Roll up the current sync state in one call: configured branch, dirty flag, and the most recent sync task (or `null` if none has ever run).

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
```

| Flag                    | Description                                                           |
| ----------------------- | --------------------------------------------------------------------- |
| `--branch <name>`, `-b` | Branch to import from (defaults to the `remote-sync-branch` setting). |
| `--force`               | Discard local Metabase-side dirty changes before importing (LOSSY).   |
| `--wait` / `--no-wait`  | Poll until the task reaches a terminal status (default: wait).        |
| `--timeout <ms>`        | Polling timeout in ms (default 600000). Used with `--wait`.           |
| `--interval <ms>`       | Polling interval in ms (default 2000). Used with `--wait`.            |

### `mb git-sync export`

Export Metabase changes back to the configured git remote (Metabase → repo). Auto-polls by default.

```sh
mb git-sync export -m "update dashboards"
mb git-sync export --branch main --json
mb git-sync export --no-wait
```

| Flag                    | Description                                                         |
| ----------------------- | ------------------------------------------------------------------- |
| `--branch <name>`, `-b` | Branch to export to (defaults to the `remote-sync-branch` setting). |
| `--message <msg>`, `-m` | Commit message for the export.                                      |
| `--force`               | Force-push / overwrite the remote branch.                           |
| `--wait` / `--no-wait`  | Poll until the task reaches a terminal status (default: wait).      |
| `--timeout <ms>`        | Polling timeout in ms (default 600000). Used with `--wait`.         |
| `--interval <ms>`       | Polling interval in ms (default 2000). Used with `--wait`.          |

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

Create a new branch on the git remote (from the last imported version) and switch sync to it.

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

## Workspaces

CRUD on `/api/ee/workspace-manager`. Run against the workspace-manager parent instance.

### `mb workspace list`

```sh
mb workspace list
mb workspace list --json
```

### `mb workspace create`

```sh
mb workspace create --name analytics
echo '{"name":"analytics"}' | mb workspace create
mb workspace create --file workspace.json
```

| Flag            | Description                                             |
| --------------- | ------------------------------------------------------- |
| `--name <name>` | Workspace name. Shortcut for `--body '{"name":"<n>"}'`. |
| `--body <json>` | Inline JSON body.                                       |
| `--file <path>` | Path to JSON body file.                                 |

### `mb workspace database provision <workspace-id>`

Provision a database into a workspace. The backend kicks off the work asynchronously and returns the workspace with the new entry in `status: "provisioning"`. Pass `--wait` to poll until the entry reaches `status: "provisioned"` and surface the polled state instead of the initial response.

```sh
mb workspace database provision 1 --database-id 5 --schemas analytics,github
mb workspace database provision 1 --database-id 5 --schemas analytics --wait
mb workspace database provision 1 --file provision.json
```

| Flag                 | Description                                                    |
| -------------------- | -------------------------------------------------------------- |
| `--database-id <id>` | Database id (used with `--schemas`).                           |
| `--schemas <csv>`    | Comma-separated input schemas (used with `--database-id`).     |
| `--body <json>`      | Inline JSON body.                                              |
| `--file <path>`      | Path to JSON body file.                                        |
| `--wait`             | Poll until the database entry reaches `status: "provisioned"`. |
| `--timeout <ms>`     | Polling timeout in ms (default 600000). Used with `--wait`.    |
| `--interval <ms>`    | Polling interval in ms (default 2000). Used with `--wait`.     |

### `mb workspace database update <workspace-id> <db-id>`

Update a workspace's provisioned database (server-side this is deprovision + provision). Body accepts only `input` — the database id comes from the URL.

```sh
mb workspace database update 1 5 --schemas analytics,github
mb workspace database update 1 5 --schemas analytics --wait
mb workspace database update 1 5 --file update.json
```

| Flag              | Description                                                       |
| ----------------- | ----------------------------------------------------------------- |
| `--schemas <csv>` | Comma-separated input schemas. Shortcut for body.                 |
| `--body <json>`   | Inline JSON body (`{"input":[{"schema":"..."}]}`).                |
| `--file <path>`   | Path to JSON body file.                                           |
| `--wait`          | Poll until the database entry returns to `status: "provisioned"`. |
| `--timeout <ms>`  | Polling timeout in ms (default 600000). Used with `--wait`.       |
| `--interval <ms>` | Polling interval in ms (default 2000). Used with `--wait`.        |

### `mb workspace database deprovision <workspace-id> <db-id>`

```sh
mb workspace database deprovision 1 5 --yes
mb workspace database deprovision 1 5 --yes --wait
```

| Flag              | Description                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `--yes`           | Skip the interactive confirmation prompt. In non-TTY contexts the prompt is skipped automatically (kubectl/gh/docker convention). |
| `--wait`          | Poll until the database entry is removed from the workspace.                                                                      |
| `--timeout <ms>`  | Polling timeout in ms (default 600000). Used with `--wait`.                                                                       |
| `--interval <ms>` | Polling interval in ms (default 2000). Used with `--wait`.                                                                        |

### Local runtime

These commands manage a Docker container that serves as the workspace's child Metabase instance. State lives in Docker labels and a named volume — there is no per-workspace local state directory. The container is named `metabase-workspace-<id>`; the app-db volume is `metabase-workspace-<id>-appdb`.

### `mb workspace start <id>`

```sh
mb workspace start 1
mb workspace start 1 --wait
mb workspace start 1 --port 3100
mb workspace start 1 --image metabase/metabase-enterprise:latest --no-pull
mb workspace start 1 --force
mb workspace start 1 --repo /path/to/sync-repo --wait
mb workspace start 1 --repo /path/to/sync-repo --repo-branch dev --repo-mode read-only
```

Resolves the parent via the active profile (or `--profile`/`--url`/`--api-key`) and the EE license via `resolveLicenseToken` (the same path `mb license set` writes to). Refuses to start if the workspace has any database that isn't `status: "provisioned"`.

The boot bundle (`config.yml`, `credentials.json`, optional `metadata.json`) is built in process memory and tar-streamed into the container's `/mw-config/` directory through `docker cp -`; no host-disk artifact is created. The CLI generates a per-workspace admin user + API key, injects them into the YAML before shipping, and stores the same values in `credentials.json` for later retrieval via `mb workspace credentials`. Once the child logs that it has read `config.yml`, the CLI scrubs the in-container copy (`docker exec rm /mw-config/config.yml`) so the warehouse credentials in `details.password` no longer linger; `credentials.json` stays.

By default `start` returns once the bundle has been consumed by the child (`state: "starting"`); pass `--wait` to also block until `/api/health` reports ready and the response reports `state: "running"`.

When `--repo <host-path>` is passed, the CLI bind-mounts the host directory at `/mnt/repo` inside the container and injects three settings into the workspace's `config.yml` so the child boots already wired to the repo: `remote-sync-url=file:///mnt/repo`, `remote-sync-branch=<branch>` (defaults to the current branch of the host repo, read via `git -C <path> symbolic-ref --short HEAD`; override with `--repo-branch`), and `remote-sync-type=<mode>` (defaults to `read-write`; override with `--repo-mode read-only`, which also makes the bind mount read-only). The bind mount is set at container-create time only — to add or change it after the fact, run `start --force` again with the new flags. The host path must be an existing directory; the CLI does not create or `git init` it for you.

| Flag                   | Description                                                                                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--port <n>`           | Host port (default: 3000; auto-shifts up to 100 ports if taken).                                                                                                                         |
| `--image <ref>`        | Docker image (default: `metabase/metabase-enterprise:latest`).                                                                                                                           |
| `--wait`               | Block until `/api/health` is ready. Default: return as soon as consumed.                                                                                                                 |
| `--timeout <ms>`       | Per-phase readiness deadline (default: 240000). Covers post-create config consumption, (with `--wait`) the `/api/health` probe, and (with `--metadata`) the metadata-import status poll. |
| `--no-pull`            | Skip `docker pull` (useful if the image is already present).                                                                                                                             |
| `--no-metadata`        | Skip the warehouse metadata export.                                                                                                                                                      |
| `--force`              | If a container for this workspace already exists, remove it before starting.                                                                                                             |
| `--repo <host-path>`   | Bind-mount a host directory at `/mnt/repo` and set `remote-sync-url=file:///mnt/repo` in `config.yml`.                                                                                   |
| `--repo-branch <name>` | `remote-sync-branch` value (default: current branch of the host repo).                                                                                                                   |
| `--repo-mode <mode>`   | `remote-sync-type`: `read-write` (default) or `read-only`. Read-only also makes the bind mount read-only.                                                                                |

### `mb workspace stop <id>`

```sh
mb workspace stop 1
mb workspace stop 1 --json
```

Stops the running container; no-ops if it's already exited or missing. Reports the prior state.

### `mb workspace remove <id>`

```sh
mb workspace remove 1 --yes
mb workspace remove 1 --keep-volume --yes
```

Stops and removes the container. By default, also removes the app-db volume — pass `--keep-volume` to preserve it across rebuilds. **Does not affect the remote workspace** on the parent.

| Flag            | Description                                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `--yes`         | Skip the interactive confirmation prompt. In non-TTY contexts the prompt is skipped automatically (kubectl/gh/docker convention). |
| `--keep-volume` | Preserve the app-db volume (`metabase-workspace-<id>-appdb`).                                                                     |

### `mb workspace logs <id>`

```sh
mb workspace logs 1
mb workspace logs 1 --follow
mb workspace logs 1 --tail 500
```

Passthrough to `docker logs`. Output streams directly to your terminal; Ctrl-C terminates a follow.

| Flag           | Description                                   |
| -------------- | --------------------------------------------- |
| `--follow, -f` | Stream indefinitely.                          |
| `--tail <n>`   | Lines from the end of the logs (default 200). |

### `mb workspace url <id>`

```sh
mb workspace url 1
mb workspace url 1 --json
```

Prints `http://localhost:<port>` for the workspace's container. Reads the host port from the container's `com.metabase.workspace.host-port` label.

### `mb workspace credentials <id>`

```sh
mb workspace credentials 1
mb workspace credentials 1 --json
```

Reads the workspace child's admin credentials (email, password, admin API key) from `/mw-config/credentials.json` inside the container. The file is written by `workspace start` from CLI-generated, per-workspace values; the same values are injected into `config.yml`'s `:users` and `:api-keys` sections so they take effect on the child's first boot. Works against running and stopped containers (uses `docker cp`); errors clearly if no container exists for the given workspace id. Removing the container destroys the file — recover by `workspace start <id> --force`.

### `mb workspace ps`

```sh
mb workspace ps
mb workspace ps --json
```

Lists every container that carries the `com.metabase.workspace.id` label, running or stopped. The `--json` envelope is the canonical agent-facing shape and contains only `workspace_id`, `workspace_name`, `state`, and `url`; `--full --json` emits the wider record (image, profile, parent URL, container name, status string, host port).

## Instance setup

Operations against a workspace-instance Metabase. The setup wizard and API key creation are distinct endpoints — there is no shared body schema.

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

### `mb api-key create`

Create a new API key (`POST /api/api-key`). The unmasked key is returned on creation only; capture it from the output.

```sh
mb api-key create --name deploy-bot --group-id 2
echo '{"name":"k","group_id":2}' | mb api-key create
mb api-key create --file key.json
```

| Flag              | Description                               |
| ----------------- | ----------------------------------------- |
| `--name <name>`   | API key name (used with `--group-id`).    |
| `--group-id <id>` | Permission group id (used with `--name`). |
| `--body <json>`   | Inline JSON body.                         |
| `--file <path>`   | Path to JSON body file.                   |

## Agent helpers

Endpoints commonly used by agents driving the instance. `card query` and `transform run` are documented in their own sections; the helper below covers entity-id translation.

### `mb eid translate`

Translate string entity ids (EIDs) to numeric ids (`POST /api/eid-translation/translate`).

```sh
mb eid translate --model card --eids abc123XYZ,def456ABC
mb eid translate --file translate.json
mb eid translate --body '{"entity_ids":{"card":["abc123XYZ"]}}'
```

| Flag             | Description                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| `--model <name>` | Entity model for the shortcut form (e.g. `card`, `dashboard`, `collection`). Used with `--eids`. |
| `--eids <csv>`   | Comma-separated EIDs. Used with `--model`.                                                       |
| `--body <json>`  | Inline JSON body.                                                                                |
| `--file <path>`  | Path to JSON body file.                                                                          |

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

Any non-MBQL 5 body skips pre-flight automatically — legacy MBQL 4 (`{ "type": "query", "database": N, "query": { "source-table": T, ... } }`), legacy native (`{ "type": "native", "database": N, "native": { "query": "..." } }`), or any other shape that doesn't carry `"lib/type": "mbql/query"`. The bundled schema only models MBQL 5; `/api/dataset` normalizes the rest server-side via `lib-be/normalize-query` (the same normalizer that backs `card create` / `transform create`), so behavior is symmetric across endpoints. `--dry-run` on a non-MBQL 5 body emits `{ ok: true, errors: [] }` (no schema applies). The double-wrap footgun — an MBQL 5 query nested inside a `{type:"query", query:…}` envelope — is still rejected with a `ConfigError` before send.

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

### MBQL 5 pre-flight in `card create`/`update`, `transform create`/`update`, `measure create`/`update`, and `segment create`/`update`

When the embedded query (`card.dataset_query`, `transform.source.query` for `source.type: "query"`, or `measure.definition` / `segment.definition`) is MBQL 5 (`lib/type: "mbql/query"`), it is pre-flight-validated against the same schema as `mb query`. Validation failure: `{ ok, errors }` envelope on stdout, exit 2, request not made. MBQL 4 (legacy) bodies and Python transform sources skip validation — they're still accepted by the server and we don't ship a schema for them.

Pass `--skip-validate` to bypass the pre-flight on any of `card create`, `card update`, `transform create`, `transform update`, `measure create`, `measure update`, `segment create`, or `segment update` — the body is sent as-is and the server is the authority. Same escape hatch as on `mb query`; use only when the bundled schema disagrees with what the server actually accepts.

Agent discovery path: `mb __manifest` lists every command's args and description; the description for `card create`/`update`, `transform create`/`update`, `measure create`/`update`, and `segment create`/`update` references `mb query --print-schema` so an agent can fetch the validating schema directly.

The bundled query schema is synced from a pinned `@metabase/representations` release via `bun run sync:representations`; CI guards against drift.

### Card-reference pre-flight in `dashboard create` / `dashboard update`

Before either command sends anything, every positive `card_id` referenced from the body's `dashcards` array is checked against `GET /api/card/:id` in parallel (de-duplicated per id). Cards that don't exist, are archived, or aren't readable fail pre-flight: the CLI writes a `{ ok: false, errors: [{ path, message }] }` envelope to stdout (one entry per offending dashcard, `path` is a JSON pointer like `/dashcards/3/card_id`) and exits **2** with `dashboard card-reference pre-flight failed: N error(s) — fix the dashcard card_id values listed above` on stderr. No dashboard is created or modified on a pre-flight miss — this is the contract that prevents orphan dashboards when a stale spec references an archived or missing card.

There is no `--skip-validate` escape hatch here. The pre-flight queries live server state (no bundled schema to drift from), so the only legitimate path on a pre-flight miss is to fix the input.

If the chained `PUT /api/dashboard/:id` fails _after_ the create has already inserted the row (rare with pre-flight in place, but possible on a permission / 5xx / network failure mid-flight), the user-facing error is rewritten to `dashboard <id> created but follow-up PUT /api/dashboard/<id> failed: <reason>; dashcards not applied`, so the caller knows the orphan exists. Recovery: `dashboard update <id> --body '{"dashcards":[...]}'` to retry the dashcards, or `dashboard update <id> --body '{"archived":true}'` to archive the orphan.

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
mb skills list                              # discover bundled skills (table or JSON)
mb skills get core                          # print the top-level guide
mb skills get core --full                   # include references and templates
mb skills get workspace,transform           # comma-separated, multi-skill fetch
mb skills get --all --json --max-bytes 0    # every non-hidden skill, structured (default cap truncates)
mb skills path                              # absolute paths for direct Read
mb skills path core                         # one path
```

`mb skills get` honors the shared `--max-bytes` list cap. With the default 65 536 cap, `--all` will return only the first skill and emit a truncation notice — pass `--max-bytes 0` to dump every skill in one envelope.

Bundled skills:

| Name        | Use                                                                                    |
| ----------- | -------------------------------------------------------------------------------------- |
| `core`      | Top-level guide: auth, flag conventions, output flags, body input, every command group |
| `workspace` | Enterprise workspace lifecycle (create, provision, start, child credentials, diagnose) |
| `transform` | Authoring and running transforms (native SQL + MBQL 5), iteration, run inspection      |
| `git-sync`  | Round-tripping Metabase content to/from a git remote                                   |

Discovery surfaces:

- **Claude Code plugin marketplace**: `.claude-plugin/marketplace.json` declares a `metabase-cli` plugin pointing at the in-repo discovery stub. Users install with `/plugin marketplace add metabase/mb-cli` then `/plugin install metabase-cli@metabase`.
- **`npx skills add`**: the same stub at `skills/metabase-cli/SKILL.md` is picked up by `npx skills add metabase/mb-cli`. The stub is intentionally minimal — it redirects the agent at `mb skills get core` so the real workflow content always comes from the installed CLI version.

Exit codes: `0` success, `2` `ConfigError` (missing name, unknown name, `MB_SKILLS_DIR` not a directory), `1` unexpected I/O.

## Environment variables

| Variable                 | Effect                                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `METABASE_URL`           | Default URL for `auth login` and config resolution.                                                                    |
| `METABASE_API_KEY`       | Default API key (overrides interactive prompt; not stored).                                                            |
| `METABASE_PROFILE`       | Default profile when `--profile` is omitted. Falls back to `default`.                                                  |
| `METABASE_LICENSE_TOKEN` | Default license token for `license set`.                                                                               |
| `METABASE_VERBOSE`       | When set to `1`, prints structured developer-detail JSON to stderr on failure.                                         |
| `MB_SKILLS_DIR`          | Override the directory `mb skills` scans (dev/test only; defaults to the CLI's bundled `skills` + `skill-data` trees). |

## Agent integration

### `mb __manifest`

Hidden command that emits a machine-readable JSON manifest of every leaf command — name, description, examples, citty args, and the output Zod schema rendered as JSON Schema. Intended for agents that need typed capability discovery instead of scraping `--help`.

```sh
mb __manifest | jq '.commands[].command'
```

The manifest schema (`Manifest`) is exported from `src/runtime/manifest.ts`.

## Exit codes

| Code  | Meaning                                                |
| ----- | ------------------------------------------------------ |
| `0`   | Success.                                               |
| `1`   | Verification or operation failed.                      |
| `2`   | Configuration error (invalid flag, missing TTY, etc.). |
| `130` | Interactive prompt cancelled (Ctrl+C).                 |
