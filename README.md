# metabase-cli

Command-line client for Metabase. Authenticates against an instance with an API key and stores it securely on your machine.

## Install

```sh
npm install -g @metabase/cli
metabase --help
```

Or build from source:

```sh
bun install
bun run build
node dist/cli.mjs --help
```

The binary is `metabase`. Examples below use that name.

## Quick start

```sh
metabase auth login --url https://metabase.example.com
metabase auth status
```

## Authentication

Credentials are stored per-profile. The default profile is named `default`. Use `--profile <name>` to manage additional profiles.

### `metabase auth login`

Save credentials for a profile.

| Flag                | Description                                                |
| ------------------- | ---------------------------------------------------------- |
| `--url <url>`       | Metabase URL. Falls back to `METABASE_URL`, then prompts.  |
| `--api-key <value>` | API key. Visible in shell history — pipe on stdin instead. |
| `--profile <name>`  | Profile to write to (default: `default`).                  |
| `--skip-verify`     | Save without contacting the server.                        |

Resolution order for the API key: `--api-key` → piped stdin → `METABASE_API_KEY` → interactive prompt. Stdin is auto-detected when not a TTY.

```sh
echo "$MB_KEY" | metabase auth login --url https://m.example.com
metabase auth login --url https://m.example.com < key.txt
```

### `metabase auth status`

Show whether a profile is authenticated.

```sh
metabase auth status
metabase auth status --json
metabase auth status --profile staging
```

| Flag               | Description                              |
| ------------------ | ---------------------------------------- |
| `--profile <name>` | Profile to inspect (default: `default`). |
| `--json`           | Emit JSON. Auto-enabled on non-TTY.      |

### `metabase auth list`

List configured authentication profiles. The index is maintained at `<configDir>/profiles.json` and updated on every `auth login` / `auth logout`. Profiles whose URL/API key were stored in the OS keychain before the index existed are picked up by a one-time backfill from `credentials.json`; profiles that exist only in the keyring (no entry in `credentials.json`) appear after the next `auth login` or `auth logout` against them.

```sh
metabase auth list
metabase auth list --json
```

| Flag     | Description                         |
| -------- | ----------------------------------- |
| `--json` | Emit JSON. Auto-enabled on non-TTY. |

### `metabase auth logout`

Clear stored credentials for a profile.

```sh
metabase auth logout --yes
metabase auth logout --profile staging --yes
```

| Flag               | Description                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `--profile <name>` | Profile to clear (default: `default`).                                                                                            |
| `--yes`            | Skip the interactive confirmation prompt. In non-TTY contexts the prompt is skipped automatically (kubectl/gh/docker convention). |

## License

Manage the Metabase Enterprise license token.

### `metabase license set [token]`

Store a license token. Resolution order: positional → piped stdin → `METABASE_LICENSE_TOKEN` → interactive prompt. Stdin is auto-detected when not a TTY.

Common output flags (`--json`, `--format`, `--detail`, `--fields`, `--max-bytes`) are accepted; the result payload is rendered through the standard output layer.

```sh
echo "$MB_LICENSE" | metabase license set
metabase license set < token.txt
```

### `metabase license status`

Show whether a license is stored. Does not reveal the value.

```sh
metabase license status
metabase license status --json
```

| Flag     | Description                         |
| -------- | ----------------------------------- |
| `--json` | Emit JSON. Auto-enabled on non-TTY. |

### `metabase license remove`

Clear the stored license.

```sh
metabase license remove --yes
```

| Flag    | Description                                                                                                                       |
| ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `--yes` | Skip the interactive confirmation prompt. In non-TTY contexts the prompt is skipped automatically (kubectl/gh/docker convention). |

Common output flags (`--json`, `--format`, `--detail`, `--fields`, `--max-bytes`) are accepted; the result payload is rendered through the standard output layer.

## Transforms

CRUD on `/api/transform`. Bodies for `create` / `update` are JSON; resolution order: `--body` → `--file` → piped stdin (auto-detected when stdin is not a TTY).

### `metabase transform list`

```sh
metabase transform list
metabase transform list --json
```

### `metabase transform get <id>`

```sh
metabase transform get 1 --json
```

### `metabase transform create`

```sh
cat transform.json | metabase transform create
metabase transform create --file transform.json
```

| Flag            | Description             |
| --------------- | ----------------------- |
| `--body <json>` | Inline JSON body.       |
| `--file <path>` | Path to JSON body file. |

### `metabase transform update <id>`

```sh
metabase transform update 1 --body '{"name":"renamed"}'
```

Same `--body` / `--file` resolution as `create`. Stdin is auto-detected when not a TTY.

### `metabase transform delete <id>`

```sh
metabase transform delete 1 --yes
```

| Flag    | Description                                                                                                                       |
| ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `--yes` | Skip the interactive confirmation prompt. In non-TTY contexts the prompt is skipped automatically (kubectl/gh/docker convention). |

### `metabase transform run <id>`

Trigger a manual run. Returns `{message, run_id}` and exits immediately. Pass `--wait` to poll until the run reaches a terminal status (`succeeded`, `failed`, `timeout`, `canceled`); the `final` field on the result holds the polled run state, and the command exits 1 if the final status is anything but `succeeded`.

```sh
metabase transform run 1
metabase transform run 1 --wait --json
```

| Flag              | Description                                                 |
| ----------------- | ----------------------------------------------------------- |
| `--wait`          | Poll until the run reaches a terminal status.               |
| `--timeout <ms>`  | Polling timeout in ms (default 600000). Used with `--wait`. |
| `--interval <ms>` | Polling interval in ms (default 2000). Used with `--wait`.  |

### `metabase transform cancel <id>`

Cancel the currently-running run for a transform. Exits 0 with `{canceled: true, id}` on success; exits 1 with a 404 if the transform has no active run.

```sh
metabase transform cancel 1
metabase transform cancel 1 --json
```

### `metabase transform get-run <run-id>`

Fetch a single run by run id (not transform id). Same compact / `--full` projection convention as `transform get`.

```sh
metabase transform get-run 1 --json
```

### `metabase transform runs`

List recent transform runs across all transforms, or filter to one. Drains all pages by default; pass `--limit` to cap.

```sh
metabase transform runs
metabase transform runs --transform-id 1 --json
metabase transform runs --limit 10 --json
```

| Flag                  | Description                                         |
| --------------------- | --------------------------------------------------- |
| `--transform-id <id>` | Filter to runs of a single transform id.            |
| `--limit <n>`         | Cap total runs returned (default: drain all pages). |

## Transform jobs

CRUD on `/api/transform-job`. Bodies for `create` / `update` follow the same `--body` / `--file` / stdin pattern as transforms.

### `metabase transform-job list`

```sh
metabase transform-job list --json
```

### `metabase transform-job get <id>`

```sh
metabase transform-job get 1 --json
```

### `metabase transform-job create`

```sh
metabase transform-job create --body '{"name":"daily","schedule":"0 0 0 * * ?"}'
```

| Flag            | Description             |
| --------------- | ----------------------- |
| `--body <json>` | Inline JSON body.       |
| `--file <path>` | Path to JSON body file. |

### `metabase transform-job update <id>`

```sh
metabase transform-job update 1 --body '{"schedule":"0 0 6 * * ?"}'
```

### `metabase transform-job delete <id>`

```sh
metabase transform-job delete 1 --yes
```

| Flag    | Description                                                                                                                       |
| ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `--yes` | Skip the interactive confirmation prompt. In non-TTY contexts the prompt is skipped automatically (kubectl/gh/docker convention). |

## Databases

Read warehouse metadata from `/api/database`. The `db` group exposes the full database list, the per-database record, hydrated metadata (tables + fields rolled up in one response), schema and table inspection, and the two manual-sync triggers.

`db` is aliased to `database`.

### `metabase db list`

```sh
metabase db list
metabase db list --json
metabase db list --include tables --full --json
metabase db list --saved --json
```

| Flag                | Description                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| `--include <which>` | Hydrate related entities. Currently only `tables` is supported (each database is returned with its `tables`). |
| `--saved`           | Include the Saved Questions virtual database in the list. The virtual db has id `-1337` and no `engine`.      |

### `metabase db get <id>`

```sh
metabase db get 1
metabase db get 1 --json
metabase db get 1 --include tables.fields --full --json
```

| Flag                | Description                                                   |
| ------------------- | ------------------------------------------------------------- |
| `--include <which>` | Hydrate related entities. One of `tables` or `tables.fields`. |

### `metabase db metadata <id>`

Equivalent to `GET /api/database/:id/metadata`: a single database with all its tables and fields rolled up in one response. Use this when an agent needs a one-shot warehouse introspection rather than the per-table `metabase table get --full`.

```sh
metabase db metadata 1 --json --full --max-bytes 0
```

### `metabase db schemas <id>`

List the schemas in a database. Schemas with no tables are excluded.

```sh
metabase db schemas 1
metabase db schemas 1 --json
```

### `metabase db schema-tables <id> <schema>`

List the tables in a given schema, sorted by display name.

```sh
metabase db schema-tables 1 public
metabase db schema-tables 1 analytics --json
```

### `metabase db sync-schema <id>`

Trigger a manual schema sync (`POST /api/database/:id/sync_schema`). Returns `{ id, status: "ok" }` once the sync has been queued; the actual work happens asynchronously on the server.

```sh
metabase db sync-schema 1
metabase db sync-schema 1 --json
```

### `metabase db rescan-values <id>`

Trigger a rescan of cached field values (`POST /api/database/:id/rescan_values`). Returns `{ id, status: "ok" }` once the rescan has been queued.

```sh
metabase db rescan-values 1
metabase db rescan-values 1 --json
```

## Tables

Inspect and edit warehouse tables via `/api/table`.

### `metabase table list`

```sh
metabase table list
metabase table list --db-id 1 --json
```

| Flag           | Description                         |
| -------------- | ----------------------------------- |
| `--db-id <id>` | Filter tables by their database id. |

### `metabase table get <id>`

Returns the basic table record (no fields). Use `metabase table metadata <id>` when you want the rollup with fields/FKs/dimensions hydrated.

```sh
metabase table get 42
metabase table get 42 --json
```

### `metabase table metadata <id>`

`GET /api/table/:id/query_metadata`: the table with its fields, FKs, and dimensions hydrated. The agent-facing one-shot introspection for a single table.

```sh
metabase table metadata 42 --json --full --max-bytes 0
```

### `metabase table fields <id>`

List the fields on a table (a thin projection over `query_metadata.fields`).

```sh
metabase table fields 42
metabase table fields 42 --json
```

### `metabase table update <id>`

Patch a table (`PUT /api/table/:id`). Body fields: `display_name`, `description`, `caveats`, `points_of_interest`, `entity_type`, `visibility_type`, `field_order`, `show_in_getting_started`. Pass the body via `--body`, `--file`, or stdin (exactly one).

```sh
metabase table update 42 --body '{"display_name":"Customers"}'
metabase table update 42 --file patch.json
echo '{"description":"Customer dimension"}' | metabase table update 42
```

## Fields

Inspect and edit individual columns via `/api/field`.

### `metabase field get <id>`

```sh
metabase field get 100
metabase field get 100 --json
```

### `metabase field values <id>`

Fetch the cached distinct values list (`GET /api/field/:id/values`). Returns the FieldValues envelope (`{ values, field_id, has_more_values }`); empty `values` on fields whose `has_field_values` is `none` or `search`.

```sh
metabase field values 100 --json
```

### `metabase field summary <id>`

Row count and distinct count for the field (`GET /api/field/:id/summary`). Metabase returns this as an array-of-pairs; the CLI normalizes it to `{ field_id, count, distincts }`.

```sh
metabase field summary 100
metabase field summary 100 --json
```

### `metabase field update <id>`

Patch a field (`PUT /api/field/:id`). Body fields: `display_name`, `description`, `caveats`, `points_of_interest`, `semantic_type`, `coercion_strategy`, `fk_target_field_id`, `visibility_type`, `has_field_values`, `settings`, `nfc_path`, `json_unfolding`. Pass the body via `--body`, `--file`, or stdin.

```sh
metabase field update 100 --body '{"description":"customer email","semantic_type":"type/Email"}'
metabase field update 100 --file patch.json
```

## Cards

CRUD plus query execution on `/api/card`. A "card" is a Metabase question, model, or metric. The `query` subcommand runs the card and either returns Metabase's JSON envelope or streams a raw CSV / XLSX export.

### `metabase card list`

```sh
metabase card list
metabase card list --filter archived --json
metabase card list --filter using_model --model-id 42 --json
```

| Flag                | Description                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `--filter <preset>` | One of `all` (default), `mine`, `bookmarked`, `database`, `table`, `archived`, `using_model`, `using_segment`. |
| `--model-id <id>`   | Required when `--filter` is `database`, `table`, `using_model`, or `using_segment`.                            |

### `metabase card get <id>`

```sh
metabase card get 1
metabase card get 1 --json --detail full
```

### `metabase card query <id>`

Run the card's query. Without `--export-format`, returns the Metabase JSON envelope (`status`, `row_count`, `data: { rows, cols }`, …). With `--export-format csv` or `--export-format xlsx`, the export bytes stream straight to stdout.

```sh
metabase card query 1 --json
metabase card query 1 --json --limit 20
metabase card query 1 --export-format csv > export.csv
metabase card query 1 --export-format xlsx > export.xlsx
metabase card query 1 --parameters '[{"type":"category","value":"A","target":["variable",["template-tag","c"]]}]'
```

| Flag                    | Description                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| `--export-format <fmt>` | Stream the export instead of the JSON envelope. One of `csv`, `xlsx`.                      |
| `--parameters <json>`   | JSON array of Metabase parameter objects (the same shape Metabase POSTs from a dashboard). |
| `--limit <n>`           | Cap rows kept in the JSON envelope. No effect on `csv` / `xlsx` exports.                   |

### `metabase card create`

```sh
cat card.json | metabase card create
metabase card create --file card.json
metabase card create --body '{"name":"x","display":"table","dataset_query":{...},"visualization_settings":{}}'
```

| Flag            | Description             |
| --------------- | ----------------------- |
| `--body <json>` | Inline JSON body.       |
| `--file <path>` | Path to JSON body file. |

### `metabase card update <id>`

Patch a card. Body is a partial subset of the create shape (`name`, `display`, `dataset_query`, `visualization_settings`, `description`, `archived`, `collection_id`, `dashboard_id`, `cache_ttl`, `parameters`, `parameter_mappings`, etc.). Only the keys you send are touched. If `dataset_query` is MBQL 5 (`lib/type: "mbql/query"`) it goes through the same pre-flight validation as `card create` and `metabase query`; pass `--skip-validate` to bypass.

```sh
cat patch.json | metabase card update 1
metabase card update 1 --file patch.json
metabase card update 1 --body '{"name":"renamed"}'
metabase card update 1 --body '{"display":"bar"}'
metabase card update 1 --body '{"archived":true}'
metabase card update 1 --file patch.json --skip-validate
```

| Flag              | Description                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--body <json>`   | Inline JSON body.                                                                                                                                      |
| `--file <path>`   | Path to JSON body file.                                                                                                                                |
| `--skip-validate` | Skip the local MBQL 5 pre-flight validation; let the server be the authority. Use only when the bundled schema disagrees with what the server accepts. |

### `metabase card archive <id>`

Soft-delete a card by setting `archived: true`. The archived card stays available via `card list --filter archived` and `card get <id>` until permanently deleted server-side. To unarchive (or otherwise toggle the flag) use `metabase card update <id> --body '{"archived":false}'`.

```sh
metabase card archive 1
metabase card archive 1 --json
```

## Dashboards

Read and write dashboards on `/api/dashboard`. A dashboard groups cards (questions, models, metrics) into a single layout. Each card on a dashboard is a "dashcard" — a placement record with its own id, position (`row`/`col`), and size (`size_x`/`size_y`). Dashcards live nested inside the parent dashboard's `dashcards` array; the API has no per-dashcard endpoint, so single-dashcard edits round-trip through `PUT /api/dashboard/:id`.

### `metabase dashboard list`

```sh
metabase dashboard list
metabase dashboard list --json
metabase dashboard list --filter archived --json
```

| Flag                | Description                                 |
| ------------------- | ------------------------------------------- |
| `--filter <preset>` | One of `all` (default), `mine`, `archived`. |

### `metabase dashboard get <id>`

```sh
metabase dashboard get 1
metabase dashboard get 1 --json
metabase dashboard get 1 --json --full
```

`--full` returns the full hydrated dashboard including the `dashcards` and `tabs` arrays. The default compact view returns only `id`, `name`, `description`, `archived`, and `collection_id`.

### `metabase dashboard cards <id>`

List the dashcards on a dashboard.

```sh
metabase dashboard cards 1
metabase dashboard cards 1 --json
```

### `metabase dashboard create`

The body accepts the same dashboard-level fields as the underlying `POST /api/dashboard` (`name`, `description`, `parameters`, `cache_ttl`, `collection_id`, `collection_position`). It also accepts optional `dashcards` and `tabs`: when either is present, the CLI chains a `PUT /api/dashboard/:id` after the create and returns the updated dashboard with its dashcards/tabs applied. Use a negative `id` on a dashcard to indicate one the server should newly create.

```sh
cat dashboard.json | metabase dashboard create
metabase dashboard create --file dashboard.json
metabase dashboard create --body '{"name":"My Dashboard","collection_id":4}'
metabase dashboard create --body '{"name":"D","dashcards":[{"id":-1,"card_id":42,"row":0,"col":0,"size_x":12,"size_y":6}]}'
```

| Flag            | Description                                         |
| --------------- | --------------------------------------------------- |
| `--body <json>` | Inline JSON body.                                   |
| `--file <path>` | Path to JSON body file. Use `-` to read from stdin. |

### `metabase dashboard update <id>`

Patch a dashboard. To edit the dashcard set, send the entire `dashcards` array — IDs not in the array get deleted, and a negative `id` indicates a new dashcard the server should create.

```sh
cat patch.json | metabase dashboard update 1
metabase dashboard update 1 --file patch.json
metabase dashboard update 1 --body '{"name":"renamed"}'
metabase dashboard update 1 --body '{"dashcards":[{"id":-1,"card_id":42,"row":0,"col":0,"size_x":12,"size_y":6}]}'
```

### `metabase dashboard update-dashcard <dashboard-id> <dashcard-id>`

Patch a single dashcard's layout or settings. The command does the round-trip for you: `GET /api/dashboard/:id`, merges the patch into the targeted dashcard while preserving every other dashcard verbatim, then `PUT`s the whole array back.

```sh
metabase dashboard update-dashcard 1 5 --body '{"row":2,"col":0}'
metabase dashboard update-dashcard 1 5 --body '{"size_x":12,"size_y":4}'
cat patch.json | metabase dashboard update-dashcard 1 5
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

### `metabase snippet list`

```sh
metabase snippet list
metabase snippet list --json
metabase snippet list --archived --json
```

| Flag         | Description                                    |
| ------------ | ---------------------------------------------- |
| `--archived` | Show archived snippets instead of active ones. |

### `metabase snippet get <id>`

```sh
metabase snippet get 1
metabase snippet get 1 --json --full
```

### `metabase snippet create`

```sh
cat snippet.json | metabase snippet create
metabase snippet create --file snippet.json
metabase snippet create --body '{"name":"active","content":"WHERE active = true"}'
```

| Flag            | Description             |
| --------------- | ----------------------- |
| `--body <json>` | Inline JSON body.       |
| `--file <path>` | Path to JSON body file. |

Body fields: `name` (required), `content` (required), `description` (optional), `collection_id` (optional positive integer).

### `metabase snippet update <id>`

Patch a snippet. Body is a partial subset of the create shape plus `archived`. Only the keys you send are touched.

```sh
cat patch.json | metabase snippet update 1
metabase snippet update 1 --file patch.json
metabase snippet update 1 --body '{"name":"renamed"}'
metabase snippet update 1 --body '{"archived":true}'
```

| Flag            | Description             |
| --------------- | ----------------------- |
| `--body <json>` | Inline JSON body.       |
| `--file <path>` | Path to JSON body file. |

### `metabase snippet archive <id>`

Soft-delete a snippet by setting `archived: true`. To unarchive use `metabase snippet update <id> --body '{"archived":false}'`.

```sh
metabase snippet archive 1
metabase snippet archive 1 --json
```

## Segments

CRUD on `/api/segment`. A segment is a saved MBQL filter macro tied to a table — used in card filters to share a reusable predicate. Mutating endpoints require a `revision_message` for the audit log.

### `metabase segment list`

```sh
metabase segment list
metabase segment list --json
```

### `metabase segment get <id>`

```sh
metabase segment get 1
metabase segment get 1 --json --full
```

### `metabase segment create`

```sh
cat segment.json | metabase segment create
metabase segment create --file segment.json
```

| Flag            | Description             |
| --------------- | ----------------------- |
| `--body <json>` | Inline JSON body.       |
| `--file <path>` | Path to JSON body file. |

Body fields: `name` (required), `table_id` (required positive integer), `definition` (required MBQL filter object), `description` (optional).

### `metabase segment update <id>`

Patch a segment. The body MUST include `revision_message`. Other keys are partial: `name`, `definition`, `archived`, `description`, `caveats`, `points_of_interest`, `show_in_getting_started`.

```sh
cat patch.json | metabase segment update 1
metabase segment update 1 --file patch.json
metabase segment update 1 --body '{"name":"renamed","revision_message":"rename"}'
```

| Flag            | Description             |
| --------------- | ----------------------- |
| `--body <json>` | Inline JSON body.       |
| `--file <path>` | Path to JSON body file. |

### `metabase segment archive <id>`

Soft-delete a segment by setting `archived: true`. The default revision message is `"Archived via metabase CLI"`; override with `--revision-message`.

```sh
metabase segment archive 1
metabase segment archive 1 --revision-message "deprecated"
```

| Flag                        | Description                                 |
| --------------------------- | ------------------------------------------- |
| `--revision-message <text>` | Audit-log message recorded with the change. |

## Measures

CRUD on `/api/measure`. A measure is a saved MBQL aggregation (a single `:aggregation` clause) tied to a table — referenced from cards and metrics to share a reusable computation. Mutating endpoints require a `revision_message` for the audit log.

### `metabase measure list`

```sh
metabase measure list
metabase measure list --json
```

### `metabase measure get <id>`

```sh
metabase measure get 1
metabase measure get 1 --json --full
```

### `metabase measure create`

```sh
cat measure.json | metabase measure create
metabase measure create --file measure.json
```

| Flag            | Description             |
| --------------- | ----------------------- |
| `--body <json>` | Inline JSON body.       |
| `--file <path>` | Path to JSON body file. |

Body fields: `name` (required), `table_id` (required positive integer), `definition` (required MBQL aggregation object), `description` (optional).

### `metabase measure update <id>`

Patch a measure. The body MUST include `revision_message`. Other keys are partial: `name`, `definition`, `archived`, `description`.

```sh
cat patch.json | metabase measure update 1
metabase measure update 1 --file patch.json
metabase measure update 1 --body '{"name":"renamed","revision_message":"rename"}'
```

| Flag            | Description             |
| --------------- | ----------------------- |
| `--body <json>` | Inline JSON body.       |
| `--file <path>` | Path to JSON body file. |

### `metabase measure archive <id>`

Soft-delete a measure by setting `archived: true`. The default revision message is `"Archived via metabase CLI"`; override with `--revision-message`.

```sh
metabase measure archive 1
metabase measure archive 1 --revision-message "deprecated"
```

| Flag                        | Description                                 |
| --------------------------- | ------------------------------------------- |
| `--revision-message <text>` | Audit-log message recorded with the change. |

## Collections

Read collections on `/api/collection`. Collections are the folders that contain cards, dashboards, and other collections. The list endpoint surfaces a virtual root collection (id `"root"`) alongside regular numeric ids; the get endpoint accepts only the numeric id.

### `metabase collection list`

```sh
metabase collection list
metabase collection list --json
metabase collection list --filter archived --json
```

| Flag                | Description                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| `--filter <preset>` | One of `all` (default), `archived` (returns the trash collection only), `personal` (only personal collections). |

### `metabase collection get <id>`

`<id>` accepts any of: a positive integer collection id, the literal `root` (the virtual "Our analytics" root), the literal `trash` (the trash collection), or a 21-character entity id (NanoID). Anything else is rejected with a `ConfigError` before any HTTP call.

```sh
metabase collection get 4
metabase collection get root --json
metabase collection get trash --json
metabase collection get voo1If9y8Sld0lXej6xl0 --json
metabase collection get 4 --json --full
```

`--full` returns the full hydrated collection including `slug`, `entity_id`, `can_write`, `namespace`, and `personal_owner_id`. The default compact view returns `id`, `name`, `description`, `archived`, `location`, `parent_id`, `type`, `authority_level`, and `is_personal`. The root collection has a stripped-down shape — `archived`, `description`, `location`, `type`, etc. are absent rather than `null`.

### `metabase collection items <id>`

List the cards, dashboards, sub-collections, and other content stored inside a collection. The CLI drains all pages of `/api/collection/:id/items`; pass `--limit` to cap the result. `<id>` accepts the same forms as `collection get` — including `root` for top-level content (items there have `collection_id: null`).

```sh
metabase collection items 4
metabase collection items root --json
metabase collection items 4 --models card,dashboard --json
metabase collection items 4 --pinned-state is_pinned --json
```

| Flag                     | Description                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `--models <csv>`         | Restrict to one or more models (`card`, `dataset`, `metric`, `dashboard`, `snippet`, `collection`, `document`, …). |
| `--archived`             | Return archived items instead of unarchived.                                                                       |
| `--pinned-state <state>` | One of `all`, `is_pinned`, `is_not_pinned`.                                                                        |
| `--limit <n>`            | Cap total items returned. Default: drain all pages.                                                                |

### `metabase collection tree`

Fetch the full collection hierarchy as a nested tree. Output is always JSON — the recursive structure does not render meaningfully as a key/value table.

```sh
metabase collection tree
metabase collection tree --json
```

### `metabase collection create`

Create a collection from a JSON spec. The body accepts the same fields as `POST /api/collection`: `name` (required), `description`, `parent_id` (omit or `null` for the root), `namespace`, and `authority_level`.

```sh
cat collection.json | metabase collection create
metabase collection create --file collection.json
metabase collection create --body '{"name":"My Collection","parent_id":4}'
```

| Flag            | Description                                         |
| --------------- | --------------------------------------------------- |
| `--body <json>` | Inline JSON body.                                   |
| `--file <path>` | Path to JSON body file. Use `-` to read from stdin. |

## Settings

Read and write Metabase instance settings via `/api/setting`. Listing all settings requires admin privileges; per-key reads/writes additionally enforce per-setting access. Setting values are always JSON — `"main"` is the string `main`, `42` is a number, `null` deletes the override and resets the value to its default.

### `metabase setting list`

```sh
metabase setting list
metabase setting list --json --max-bytes 0
```

Returns a `ListEnvelope` of compact entries (`key`, `value`, `is_env_setting`, `env_name`). Pass `--full` for the full per-row payload (also includes `description` and `default`). The full payload can exceed the default `--max-bytes` cap; pass `--max-bytes 0` to disable the cap.

### `metabase setting get <key>`

```sh
metabase setting get site-name
metabase setting get remote-sync-branch --json
```

Returns `{ key, value }` for a single setting. Settings whose stored value matches the default — or that come from an env var — surface as `value: null`.

### `metabase setting set <key> [value]`

Set or delete a setting. The value is parsed strictly as JSON: pass `'"main"'` for the string `main`, `true`/`42` for booleans/numbers, `null` to delete the stored override (resets to default).

```sh
metabase setting set remote-sync-branch '"main"'
metabase setting set anon-tracking-enabled true
echo '"main"' | metabase setting set remote-sync-branch
metabase setting set remote-sync-branch --file value.json
metabase setting set remote-sync-branch null
```

| Flag            | Description                                                              |
| --------------- | ------------------------------------------------------------------------ |
| `--file <path>` | Read the JSON value from a file (alternative to the positional / stdin). |

Sources are resolved in this order: positional, `--file`, piped stdin. Provide exactly one; an unparseable value or a missing source fails fast with a `ConfigError`.

## Search

### `metabase search [query]`

Search Metabase content (cards, dashboards, collections, tables, …). Returns a `ListEnvelope` of compact search results by default; pass `--detail full` for the full per-row payload.

```sh
metabase search orders
metabase search --models card,dashboard --limit 10 --json
metabase search products --archived
```

| Flag             | Description                                                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--models`, `-m` | Comma-separated model filter: `card,dataset,metric,dashboard,collection,database,table,segment,measure,snippet,document,action,transform,indexed-entity`. |
| `--archived`     | Include archived items only.                                                                                                                              |
| `--limit`        | Max results to return (default `20`).                                                                                                                     |
| `--table-db-id`  | Restrict to items on a given database id.                                                                                                                 |
| `--verified`     | Only verified content.                                                                                                                                    |

## Sync

Drive Metabase Enterprise Remote Sync (`/api/ee/remote-sync`) — import / export Metabase content against a configured git remote, inspect dirty state, and manage branches. All sync commands require an active EE token and superuser credentials.

### `metabase sync status`

Roll up the current sync state in one call: configured branch, dirty flag, and the most recent sync task (or `null` if none has ever run).

```sh
metabase sync status
metabase sync status --json
```

### `metabase sync is-dirty`

Boolean check for whether any synced collection has unsynced local changes.

```sh
metabase sync is-dirty --json
```

### `metabase sync has-remote-changes`

Compare the latest version on the remote branch against the version Metabase last imported. Cached for a short TTL server-side; pass `--force-refresh` to bypass.

```sh
metabase sync has-remote-changes
metabase sync has-remote-changes --force-refresh --json
```

| Flag              | Description                                         |
| ----------------- | --------------------------------------------------- |
| `--force-refresh` | Bypass the in-memory cache and re-check the remote. |

### `metabase sync dirty`

List every object that has unsynced local changes (compact list envelope; `--full` for the per-row payload).

```sh
metabase sync dirty
metabase sync dirty --json
```

### `metabase sync current-task`

Fetch the most recent sync task. Renders `{ status: "idle" }` when no task has ever run, otherwise the full task with its hydrated `status`.

```sh
metabase sync current-task
metabase sync current-task --json
```

### `metabase sync cancel-task`

Cancel the currently running sync task. Fails with HTTP 400 if no task is running.

```sh
metabase sync cancel-task --json
```

### `metabase sync wait`

Poll `/current-task` until it reaches a terminal status (`successful`, `errored`, `cancelled`, `timed-out`, `conflict`). Exits 0 on `successful` or `cancelled`; exits 1 on `errored` / `timed-out` / `conflict`. Returns immediately with `{ status: "idle" }` if no task is running.

```sh
metabase sync wait
metabase sync wait --timeout 300000 --json
```

| Flag              | Description                             |
| ----------------- | --------------------------------------- |
| `--timeout <ms>`  | Polling timeout in ms (default 600000). |
| `--interval <ms>` | Polling interval in ms (default 2000).  |

### `metabase sync import`

Import content from the configured git remote into Metabase (repo → Metabase). Auto-polls until the resulting task reaches a terminal status; pass `--no-wait` to return immediately after kickoff.

```sh
metabase sync import
metabase sync import --branch main --json
metabase sync import --force --no-wait
```

| Flag                    | Description                                                           |
| ----------------------- | --------------------------------------------------------------------- |
| `--branch <name>`, `-b` | Branch to import from (defaults to the `remote-sync-branch` setting). |
| `--force`               | Discard local Metabase-side dirty changes before importing (LOSSY).   |
| `--wait` / `--no-wait`  | Poll until the task reaches a terminal status (default: wait).        |
| `--timeout <ms>`        | Polling timeout in ms (default 600000). Used with `--wait`.           |
| `--interval <ms>`       | Polling interval in ms (default 2000). Used with `--wait`.            |

### `metabase sync export`

Export Metabase changes back to the configured git remote (Metabase → repo). Auto-polls by default.

```sh
metabase sync export -m "update dashboards"
metabase sync export --branch main --json
metabase sync export --no-wait
```

| Flag                    | Description                                                         |
| ----------------------- | ------------------------------------------------------------------- |
| `--branch <name>`, `-b` | Branch to export to (defaults to the `remote-sync-branch` setting). |
| `--message <msg>`, `-m` | Commit message for the export.                                      |
| `--force`               | Force-push / overwrite the remote branch.                           |
| `--wait` / `--no-wait`  | Poll until the task reaches a terminal status (default: wait).      |
| `--timeout <ms>`        | Polling timeout in ms (default 600000). Used with `--wait`.         |
| `--interval <ms>`       | Polling interval in ms (default 2000). Used with `--wait`.          |

### `metabase sync stash`

Export the current Metabase state to a NEW branch on the remote and switch sync to it. Requires `remote-sync-type` to be `read-write`.

```sh
metabase sync stash --new-branch wip
metabase sync stash --new-branch wip -m "work in progress" --json
```

| Flag                    | Description                                                    |
| ----------------------- | -------------------------------------------------------------- |
| `--new-branch <name>`   | Required. Branch to create and export to.                      |
| `--message <msg>`, `-m` | Commit message (default `Stashed from metabase CLI`).          |
| `--wait` / `--no-wait`  | Poll until the task reaches a terminal status (default: wait). |
| `--timeout <ms>`        | Polling timeout in ms. Used with `--wait`.                     |
| `--interval <ms>`       | Polling interval in ms. Used with `--wait`.                    |

### `metabase sync branches`

List branches available on the configured git remote.

```sh
metabase sync branches --json
```

### `metabase sync create-branch <name>`

Create a new branch on the git remote (from the last imported version) and switch sync to it.

```sh
metabase sync create-branch feat/dashboards
metabase sync create-branch feat/x --json
```

### `metabase sync add-collection <id>`

Mark a collection as remote-synced. The toggle cascades to every descendant by `location` prefix, so flagging a parent flags the whole subtree. Returns `{ success, task_id? }`; `task_id` only appears when the toggle triggers a follow-up task (e.g. a finalization import after switching to read-only mode).

```sh
metabase sync add-collection 12
metabase sync add-collection 12 --json --profile prod
```

The server rejects toggles while `remote-sync-type` is `read-only` (the install default). Switch first with `metabase setting set remote-sync-type '"read-write"'`.

### `metabase sync remove-collection <id>`

Unmark a collection as remote-synced. Same cascade and same `read-only` precondition as `add-collection`.

```sh
metabase sync remove-collection 12
metabase sync remove-collection 12 --json --profile prod
```

## Workspaces

CRUD on `/api/ee/workspace-manager`. Run against the workspace-manager parent instance.

### `metabase workspace list`

```sh
metabase workspace list
metabase workspace list --json
```

### `metabase workspace create`

```sh
metabase workspace create --name analytics
echo '{"name":"analytics"}' | metabase workspace create
metabase workspace create --file workspace.json
```

| Flag            | Description                                             |
| --------------- | ------------------------------------------------------- |
| `--name <name>` | Workspace name. Shortcut for `--body '{"name":"<n>"}'`. |
| `--body <json>` | Inline JSON body.                                       |
| `--file <path>` | Path to JSON body file.                                 |

### `metabase workspace database provision <workspace-id>`

Provision a database into a workspace. The backend kicks off the work asynchronously and returns the workspace with the new entry in `status: "provisioning"`. Pass `--wait` to poll until the entry reaches `status: "provisioned"` and surface the polled state instead of the initial response.

```sh
metabase workspace database provision 1 --database-id 5 --schemas analytics,github
metabase workspace database provision 1 --database-id 5 --schemas analytics --wait
metabase workspace database provision 1 --file provision.json
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

### `metabase workspace database update <workspace-id> <db-id>`

Update a workspace's provisioned database (server-side this is deprovision + provision). Body accepts only `input` — the database id comes from the URL.

```sh
metabase workspace database update 1 5 --schemas analytics,github
metabase workspace database update 1 5 --schemas analytics --wait
metabase workspace database update 1 5 --file update.json
```

| Flag              | Description                                                       |
| ----------------- | ----------------------------------------------------------------- |
| `--schemas <csv>` | Comma-separated input schemas. Shortcut for body.                 |
| `--body <json>`   | Inline JSON body (`{"input":[{"schema":"..."}]}`).                |
| `--file <path>`   | Path to JSON body file.                                           |
| `--wait`          | Poll until the database entry returns to `status: "provisioned"`. |
| `--timeout <ms>`  | Polling timeout in ms (default 600000). Used with `--wait`.       |
| `--interval <ms>` | Polling interval in ms (default 2000). Used with `--wait`.        |

### `metabase workspace database deprovision <workspace-id> <db-id>`

```sh
metabase workspace database deprovision 1 5 --yes
metabase workspace database deprovision 1 5 --yes --wait
```

| Flag              | Description                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `--yes`           | Skip the interactive confirmation prompt. In non-TTY contexts the prompt is skipped automatically (kubectl/gh/docker convention). |
| `--wait`          | Poll until the database entry is removed from the workspace.                                                                      |
| `--timeout <ms>`  | Polling timeout in ms (default 600000). Used with `--wait`.                                                                       |
| `--interval <ms>` | Polling interval in ms (default 2000). Used with `--wait`.                                                                        |

### Local runtime

These commands manage a Docker container that serves as the workspace's child Metabase instance. State lives in Docker labels and a named volume — there is no per-workspace local state directory. The container is named `metabase-workspace-<id>`; the app-db volume is `metabase-workspace-<id>-appdb`.

### `metabase workspace start <id>`

```sh
metabase workspace start 1
metabase workspace start 1 --wait
metabase workspace start 1 --port 3100
metabase workspace start 1 --image metabase/metabase-dev:feature-workspaces-v2 --no-pull
metabase workspace start 1 --force
metabase workspace start 1 --repo /path/to/sync-repo --wait
metabase workspace start 1 --repo /path/to/sync-repo --repo-branch dev --repo-mode read-only
```

Resolves the parent via the active profile (or `--profile`/`--url`/`--api-key`) and the EE license via `resolveLicenseToken` (the same path `metabase license set` writes to). Refuses to start if the workspace has any database that isn't `status: "provisioned"`.

The boot bundle (`config.yml`, `credentials.json`, optional `metadata.json`) is built in process memory and tar-streamed into the container's `/mw-config/` directory through `docker cp -`; no host-disk artifact is created. The CLI generates a per-workspace admin user + API key, injects them into the YAML before shipping, and stores the same values in `credentials.json` for later retrieval via `metabase workspace credentials`. Once the child logs that it has read `config.yml`, the CLI scrubs the in-container copy (`docker exec rm /mw-config/config.yml`) so the warehouse credentials in `details.password` no longer linger; `credentials.json` stays.

By default `start` returns once the bundle has been consumed by the child (`state: "starting"`); pass `--wait` to also block until `/api/health` reports ready and the response reports `state: "running"`.

When `--repo <host-path>` is passed, the CLI bind-mounts the host directory at `/mnt/repo` inside the container and injects three settings into the workspace's `config.yml` so the child boots already wired to the repo: `remote-sync-url=file:///mnt/repo`, `remote-sync-branch=<branch>` (defaults to the current branch of the host repo, read via `git -C <path> symbolic-ref --short HEAD`; override with `--repo-branch`), and `remote-sync-type=<mode>` (defaults to `read-write`; override with `--repo-mode read-only`, which also makes the bind mount read-only). The bind mount is set at container-create time only — to add or change it after the fact, run `start --force` again with the new flags. The host path must be an existing directory; the CLI does not create or `git init` it for you.

| Flag                   | Description                                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `--port <n>`           | Host port (default: 3000; auto-shifts up to 100 ports if taken).                                                                   |
| `--image <ref>`        | Docker image (default: `metabase/metabase-dev:feature-workspaces-v2`).                                                             |
| `--wait`               | Block until `/api/health` is ready. Default: return as soon as consumed.                                                           |
| `--timeout <ms>`       | Per-phase readiness deadline (default: 240000). Covers post-create config consumption and (with `--wait`) the `/api/health` probe. |
| `--no-pull`            | Skip `docker pull` (useful if the image is already present).                                                                       |
| `--no-metadata`        | Skip the warehouse metadata export.                                                                                                |
| `--force`              | If a container for this workspace already exists, remove it before starting.                                                       |
| `--repo <host-path>`   | Bind-mount a host directory at `/mnt/repo` and set `remote-sync-url=file:///mnt/repo` in `config.yml`.                             |
| `--repo-branch <name>` | `remote-sync-branch` value (default: current branch of the host repo).                                                             |
| `--repo-mode <mode>`   | `remote-sync-type`: `read-write` (default) or `read-only`. Read-only also makes the bind mount read-only.                          |

### `metabase workspace stop <id>`

```sh
metabase workspace stop 1
metabase workspace stop 1 --json
```

Stops the running container; no-ops if it's already exited or missing. Reports the prior state.

### `metabase workspace remove <id>`

```sh
metabase workspace remove 1 --yes
metabase workspace remove 1 --keep-volume --yes
```

Stops and removes the container. By default, also removes the app-db volume — pass `--keep-volume` to preserve it across rebuilds. **Does not affect the remote workspace** on the parent.

| Flag            | Description                                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `--yes`         | Skip the interactive confirmation prompt. In non-TTY contexts the prompt is skipped automatically (kubectl/gh/docker convention). |
| `--keep-volume` | Preserve the app-db volume (`metabase-workspace-<id>-appdb`).                                                                     |

### `metabase workspace logs <id>`

```sh
metabase workspace logs 1
metabase workspace logs 1 --follow
metabase workspace logs 1 --tail 500
```

Passthrough to `docker logs`. Output streams directly to your terminal; Ctrl-C terminates a follow.

| Flag           | Description                                   |
| -------------- | --------------------------------------------- |
| `--follow, -f` | Stream indefinitely.                          |
| `--tail <n>`   | Lines from the end of the logs (default 200). |

### `metabase workspace url <id>`

```sh
metabase workspace url 1
metabase workspace url 1 --json
```

Prints `http://localhost:<port>` for the workspace's container. Reads the host port from the container's `com.metabase.workspace.host-port` label.

### `metabase workspace credentials <id>`

```sh
metabase workspace credentials 1
metabase workspace credentials 1 --json
```

Reads the workspace child's admin credentials (email, password, admin API key) from `/mw-config/credentials.json` inside the container. The file is written by `workspace start` from CLI-generated, per-workspace values; the same values are injected into `config.yml`'s `:users` and `:api-keys` sections so they take effect on the child's first boot. Works against running and stopped containers (uses `docker cp`); errors clearly if no container exists for the given workspace id. Removing the container destroys the file — recover by `workspace start <id> --force`.

### `metabase workspace ps`

```sh
metabase workspace ps
metabase workspace ps --json
```

Lists every container that carries the `com.metabase.workspace.id` label, running or stopped. The `--json` envelope is the canonical agent-facing shape and contains only `workspace_id`, `workspace_name`, `state`, and `url`; `--full --json` emits the wider record (image, profile, parent URL, container name, status string, host port).

## Instance setup

Operations against a workspace-instance Metabase. The setup wizard and API key creation are distinct endpoints — there is no shared body schema.

### `metabase setup`

Complete the initial setup wizard (`POST /api/setup`). The body must include the setup token, the default user, and the `prefs` block (with `site_name`).

```sh
cat setup.json | metabase setup
metabase setup --file setup.json
metabase setup --body '{"token":"<setup-token>","user":{"email":"a@b.c","password":"..."},"prefs":{"site_name":"Acme"}}'
```

| Flag            | Description             |
| --------------- | ----------------------- |
| `--body <json>` | Inline JSON body.       |
| `--file <path>` | Path to JSON body file. |

### `metabase api-key create`

Create a new API key (`POST /api/api-key`). The unmasked key is returned on creation only; capture it from the output.

```sh
metabase api-key create --name deploy-bot --group-id 2
echo '{"name":"k","group_id":2}' | metabase api-key create
metabase api-key create --file key.json
```

| Flag              | Description                               |
| ----------------- | ----------------------------------------- |
| `--name <name>`   | API key name (used with `--group-id`).    |
| `--group-id <id>` | Permission group id (used with `--name`). |
| `--body <json>`   | Inline JSON body.                         |
| `--file <path>`   | Path to JSON body file.                   |

## Agent helpers

Endpoints commonly used by agents driving the instance. `card query` and `transform run` are documented in their own sections; the helper below covers entity-id translation.

### `metabase eid translate`

Translate string entity ids (EIDs) to numeric ids (`POST /api/eid-translation/translate`).

```sh
metabase eid translate --model card --eids abc123XYZ,def456ABC
metabase eid translate --file translate.json
metabase eid translate --body '{"entity_ids":{"card":["abc123XYZ"]}}'
```

| Flag             | Description                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| `--model <name>` | Entity model for the shortcut form (e.g. `card`, `dashboard`, `collection`). Used with `--eids`. |
| `--eids <csv>`   | Comma-separated EIDs. Used with `--model`.                                                       |
| `--body <json>`  | Inline JSON body.                                                                                |
| `--file <path>`  | Path to JSON body file.                                                                          |

## Query

### `metabase query`

Run an MBQL 5 query with built-in schema validation. Three modes — discover the schema (`--print-schema`), validate without sending (`--dry-run`), run.

Two MBQL flavors:

- **Internal MBQL** (default) — numeric IDs (`database: 1`, `source-table: 7`). POSTs to `/api/dataset`. This is what every existing Metabase API endpoint accepts.
- **External MBQL** (`--external`) — string-id FKs (`database: "My DB"`, `source-table: ["My DB", null, "orders"]`). POSTs to `/api/dataset/external` (forward-looking representations endpoint).

External and internal MBQL are structurally identical; only the ID types differ. The bundled query schema is synced from `@metabase/representations`; the internal validator overrides `id.yaml` to require positive integers for every ID `$def`.

```sh
metabase query --print-schema                     # internal JSON Schema bundle
metabase query --print-schema --external          # string-FK variant
cat q.json | metabase query --dry-run             # validate, no network
metabase query --file q.json
metabase query --file q.json --external
metabase query --file q.json --skip-validate      # bypass pre-flight; let server reject
```

Body sources: `--file`, `--body`, or stdin (exactly one). Body is JSON.

`--skip-validate` is an escape hatch when the bundled schema disagrees with what the server actually accepts (drift, false negative, edge case). Validation is skipped entirely and the body is sent as-is. Mutually exclusive with `--dry-run` (which is itself the validation mode).

Exit codes:

- `0` — valid (and the query ran successfully when not in dry-run).
- `2` — validation failed, malformed body, or `ConfigError`.
- `1` — server-side error after a valid pre-flight (network, HTTP 4xx/5xx).

Output by mode:

- `--print-schema` — `{ mode, schema, defs: { "id.yaml", "parameter.yaml", "ref.yaml", "temporal_bucketing.yaml" } }`. The query schema's `$ref`s point into the `defs` namespace by file path; an agent can either feed the bundle directly into Ajv (`addSchema(defs["id.yaml"], "id.yaml")` etc., then `compile(schema)`) or read it as documentation.
- `--dry-run` — `{ ok: boolean, errors: { path: string, message: string }[] }`. `path` is a JSON Pointer into the body, `message` is the Ajv error string.
- Run failure (no `--dry-run`) — same `{ ok, errors }` envelope on stdout, exit 2, no request made.
- Run success — the streamed `CardQueryResult`.

### MBQL 5 pre-flight in `card create`/`update` and `transform create`/`update`

When the embedded query (`card.dataset_query`, or `transform.source.query` for `source.type: "query"`) is MBQL 5 (`lib/type: "mbql/query"`), it is pre-flight-validated against the same schema as `metabase query`. Validation failure: `{ ok, errors }` envelope on stdout, exit 2, request not made. MBQL 4 (legacy) bodies and Python transform sources skip validation — they're still accepted by the server and we don't ship a schema for them.

Pass `--skip-validate` to bypass the pre-flight on `card create`, `card update`, `transform create`, or `transform update` — the body is sent as-is and the server is the authority. Same escape hatch as on `metabase query`; use only when the bundled schema disagrees with what the server actually accepts.

Agent discovery path: `metabase __manifest` lists every command's args and description; the description for `card create`/`update` and `transform create`/`update` references `metabase query --print-schema` so an agent can fetch the validating schema directly.

The bundled query schema is synced from a pinned `@metabase/representations` release via `bun run sync:representations`; CI guards against drift.

## Environment variables

| Variable                 | Effect                                                                         |
| ------------------------ | ------------------------------------------------------------------------------ |
| `METABASE_URL`           | Default URL for `auth login` and config resolution.                            |
| `METABASE_API_KEY`       | Default API key (overrides interactive prompt; not stored).                    |
| `METABASE_PROFILE`       | Default profile when `--profile` is omitted. Falls back to `default`.          |
| `METABASE_LICENSE_TOKEN` | Default license token for `license set`.                                       |
| `METABASE_VERBOSE`       | When set to `1`, prints structured developer-detail JSON to stderr on failure. |

## Agent integration

### `metabase __manifest`

Hidden command that emits a machine-readable JSON manifest of every leaf command — name, description, examples, citty args, and the output Zod schema rendered as JSON Schema. Intended for agents that need typed capability discovery instead of scraping `--help`.

```sh
metabase __manifest | jq '.commands[].command'
```

The manifest schema (`Manifest`) is exported from `src/runtime/manifest.ts`.

## Exit codes

| Code  | Meaning                                                |
| ----- | ------------------------------------------------------ |
| `0`   | Success.                                               |
| `1`   | Verification or operation failed.                      |
| `2`   | Configuration error (invalid flag, missing TTY, etc.). |
| `130` | Interactive prompt cancelled (Ctrl+C).                 |
