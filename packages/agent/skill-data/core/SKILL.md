---
name: core
description: Foundations for driving a Metabase instance with the curated tools — the tool map (what each one is for and when to reach for it), the conventions they share (concise vs detailed payloads, list envelopes, file-backed bodies, waiting on async work, create/update/delete), and the per-resource footguns (data browsing, upload, question, dashboard, collection, snippet, segment, measure, timeline, metadata, transform, settings, git-sync, library). Load first for any Metabase task; it routes to the specialized skills for deeper work.
allowed-tools: Read, Write, Edit
---

# metabase (core)

The tools drive one Metabase instance over its REST API, as one user: find content, read it, run queries, save questions and dashboards, curate metadata, operate transforms, and administer the instance. Their permissions are the boundary — content the user cannot see does not exist for you, and a write the server rejects is an answer.

The conventions below — payload shape, list envelopes, bodies on disk, async waits, write methods — hold across **every** tool. Each tool's own schema and description are the exact contract for its arguments; this file is what the schemas assume you already know. A few flows have their own skills (see "Specialized skills"). When a question needs a query, prefer MBQL over native SQL (portable, structured, pre-flight-validated — read the `mbql` skill); fall back to native SQL when MBQL cannot express it.

## The toolset

**Find it**

- `search` — keyword search across cards, models, metrics, dashboards, collections, tables, segments and more. Ranked keyword match, filterable by `type`, `collection_id` (subtree), `created_by: "me"` and `archived`; `recent: true` returns the user's recently viewed items instead. Reach for it when you have a name or a phrase, not an id.
- `browse_data` — walks the data hierarchy under an `action`: `list_databases`, `list_schemas`, `list_tables`, `list_models`, `get_fields`. This is where table ids and field ids come from.
- `browse_collection` — navigates collections: `mode: "items"` lists a collection's contents (pinned first, filterable by `type`, paginated), `mode: "tree"` shows the hierarchy re-rooted at `id` and expanded to `depth`.
- `get_content` — reads up to 10 entities in one batch (`{type, id}` pairs, mixed types allowed): question, model, metric, measure, dashboard, collection, snippet, segment, document, transform. `include` attaches extra sections where they fit: `definition`, `fields`, `parameters`, `layout`, `revisions`.
- `get_parameter_values` — the valid values behind a dashboard or question filter, so you can fill it before running.

**Run it**

- `execute_query` — runs a staged MBQL 5 query (`query` inline, or `query_file` on disk) and returns `cols` + `rows`.
- `execute_sql` — runs raw SQL against a `database_id` (`sql` inline, or `sql_file`), with `{{tag}}` placeholders filled from `template_tag_values`.
- `run_saved_question` — runs a saved card by id, optionally with `parameters` (identified by `id` or `slug`); `export: "csv" | "xlsx" | "json"` writes the full result to a file and returns its path.

**Save it**

- `question_write` — creates, updates and `pull`s questions, models and metrics: the query (MBQL or `native` SQL), `display`, `visualization_settings`, `collection_id`, `column_metadata` for a model's columns.
- `dashboard_write` — creates, updates and `pull`s dashboards. The canvas is one layout document.
- `document_write` — creates, updates, `pull`s and deletes documents: prose with live cards embedded in it.
- `snippet_write` — named SQL fragments other native questions paste in with `{{snippet: <name>}}`.
- `segment_write` — a named filter on a table.
- `measure_write` — a named aggregation on a table.
- `duplicate_content` — copies a question or a dashboard.

**Organize it**

- `collection_write` — creates, renames, moves and archives collections.

**Operate it**

- `transform_write` — creates, updates, `pull`s and deletes transforms (a query Metabase materializes as a warehouse table on a schedule).
- `transform_run` — runs a transform and blocks until it finishes, cancels an in-flight run, reads run history, walks the dependency graph, and drives jobs (`list_jobs`, `job_transforms`, `run_job`).
- `transform_job_write` — the tag-driven schedules that run transforms unattended.
- `upload_csv` — loads a CSV/TSV from disk into the uploads database as a table plus a model.
- `metadata_write` — curates the data model (`update_table`, `update_field`) and keeps Metabase's picture of the warehouse current (`sync_schema`, `rescan_values`).
- `timeline_write` — the dated markers drawn over time-series charts.

**Administer it**

- `instance_settings` — reads and writes instance-wide settings (`list` / `get` / `set`).
- `git_sync` — moves content between this instance and its git remote.
- `library` — publishes tables into the instance's shortlist of trusted data.

`transform_write`, `transform_run`, `transform_job_write`, `git_sync` and `library` are gated on the instance: they are present only when its version and paid features support them.

## Payloads and conventions

**`response_format` is `concise` by default.** Every read tool projects each record to the fields an agent needs. `detailed` returns the full REST payload — reach for it only when the compact projection is missing something you need, not by habit.

**List envelopes.** Reads that return many things come back as `{data, returned, total?, truncated?}`. `truncated` appears only when items were dropped, and its `message` names the parameter that fixes it — the narrowing filter (`type`, `schema`, `collection_id`, `filter`, `transform_id`) or the paging one (`offset`, `limit`). Follow it rather than re-issuing the same call.

**Ids are looked up, never guessed.** A table id comes from `browse_data`, a field id from `get_fields`, a card id from `search` or `browse_collection`. Inspect a table's fields before you query it.

**You never author an identifier.** Every id you send is one you read back from a tool; every id you don't have is one the server mints. You **MUST NOT** hand-write a UUID — not a `lib/uuid` in a query, not a native template-tag `id`, not any other `uuid`-shaped slot. You cannot generate a random value, so an id you type is a made-up one: it collides, or it fails a format check, or — worst — it is accepted and silently points at the wrong thing. Omit the field and let the server fill it in. If a body seems to force you to invent one, you are writing the wrong shape; re-read the skill for the shape that doesn't.

**Bodies belong in files.** `execute_query`/`question_write` take `query_file`, `execute_sql`/`question_write`/`transform_write` take `sql_file`, `dashboard_write` takes `layout_file`, `transform_write` takes `source_file`, `document_write` takes `document_file`. Paths resolve against the working directory. The point is not convenience: a query you iterate on in a file is the byte-identical query you save, and a long body never has to travel through the conversation twice. Edit it with your file tools, re-run it, then hand the same path to the write tool. Keep hand-authored working bodies under `./.scratch` — they persist across the session and the user can review them. Write JSON indented, one key per line: the user reads these files over your shoulder, and an edit to a body minified onto a single line rewrites the whole file rather than the clause you meant to change.

**Editing existing content starts with `pull`.** `question_write`, `dashboard_write`, `transform_write` and `document_write` take `{method: "pull", id}`, which writes the entity's saved body — a card's query, a dashboard's layout, a transform's source, a document's tree — straight to a file (native SQL as bare `.sql`, everything else as JSON). Pull, edit the file, `update` with the same path: the parts you didn't touch round-trip byte-identically, because they never pass through the conversation at all. Never rebuild a saved body from memory of what it contains — retyping is where fields get dropped and ids get mangled.

**Async work.** `transform_run` (`run`), `git_sync` (`import`, `export`, `stash`) and `metadata_write` (`sync_schema`) kick off server-side work. They wait for the terminal state by default and return it; `timeout_ms` bounds the wait. `transform_run`'s `run` additionally waits for the output table to register and returns `target_table_id` — the id you then build MBQL against. Without waiting you race the operation and read a state that has not landed.

**Writes take a `method`.** `create` or `update` everywhere; `document_write`, `transform_write`, `transform_job_write` and `timeline_write` also take `delete`, which is permanent and has no trash behind it; `question_write`, `dashboard_write`, `transform_write` and `document_write` also take `pull`, which writes the saved body to a file for editing. For everything else the reversible removal is `archived: true` (and `archived: false` restores). Per-method required fields are named in each parameter's description.

**Errors teach.** A rejection names the fix — a missing argument, a bad id, the near-matching setting key, the skill whose grammar the body violated. Read what it says and act on it; an adjusted guess earns a second rejection.

## Resource quirks worth memorizing

Each tool's schema tells you its arguments. Below is what the schemas do not tell you: footguns and non-obvious behavior.

- **Data browsing: the hydration ladder.** Start at `browse_data` `list_tables` for the database (compact: id, name, schema, description per table), pick the relevant tables, then `get_fields` with those `table_ids` — a batch, and one bad id fails that table, not the batch. Hundreds of tables? Traverse by schema (`list_schemas` → `list_tables` with `schema`), or find a table by name with `search` (`type: ["table"]`). When one table's fields overflow the response budget, the notice names the continuation: `get_fields` with the same `table_ids` and an `offset`. Never enumerate every field in a database — fields are per-table for a reason.
- **`list_models`** is the model inventory for one database; models are cards, so `get_content` (`type: "model"`) reads one in full.
- **Uploads (CSV → tables).** `upload_csv` `create` makes a new table plus a model over it (returns `{model_id, table_id}`); `append` and `replace` write into a table **Metabase itself created from an upload** — a warehouse table it merely synced cannot be written this way, and `replace` discards every row already there. The destination database and schema are admin-configured, not per-call: check with `instance_settings` `{action: "get", key: "uploads-settings"}` (`db_id: null` ⇒ uploads are off or unconfigured). `collection_id` only chooses where the model is saved. Files cap at 50 MB.
- **Questions.** A card's query is a **staged MBQL 5 query** (`{"lib/type": "mbql/query", "database": <id>, "stages": [...]}`), not a legacy `{type, query}` envelope (→ `mbql`). `card_type` picks what you are saving: `question` (a saved query), `model` (a curated table others start from), `metric` (a saved aggregation others reference). A metric's last stage holds **exactly one aggregation** and at most one time grouping — `question_write` refuses more, because a metric with two aggregations is two metrics. `column_metadata` curates a **model's** columns only, merged by column `name`. `display` and `visualization_settings` are top-level arguments saved with the card — set them in the `create`, not in a follow-up `update`; their keys are scoped by `display` and not pre-flighted — read `visualization`. Every write returns the entity with its `id` — hold onto it; a later `update` is addressed by that `id`, never by name. To fix an existing card's query, `pull` it to a file (`.sql` for a native card, JSON for a structured one), edit, and `update` with the same path — a native pull also returns the card's `template_tags` to pass back through unchanged.
- **Measure vs. metric.** A measure lives on a table and questions reuse it as a column (`measure_write`); a metric is a standalone card (`question_write` with `card_type: "metric"`). They are not two names for one thing.
- **Dashboards: the layout document is the whole canvas.** `dashboard_write` `pull` writes the current layout to a file; you edit it; `update` with the same `layout_file` applies it as one write. **A dashcard the document omits is removed**, so always start an edit from a `pull` — never hand-assemble a partial canvas over an existing dashboard. Dashboard-level fields (`name`, `description`, `collection_id`, `collection_position`, `archived`, `width`) are top-level arguments and need no layout at all. `validate_only: true` compiles the document and shows the resulting write without applying it.
- **Dashboard geometry.** The grid is **24 columns wide**: each dashcard's `{row, col, size_x, size_y}` is in grid units, so **full width is `size_x: 24`** — `size_x: 12` is half a row, the usual cause of a card filling only half the width. Omit `row`/`col` to autoplace, and omit `size_x`/`size_y` to take the display's default (`table` 12×9, `line`/`bar`/`area`/`row`/`funnel`/`map` 12×6, `pie` 12×8, `scalar` 6×3, `heading` 24×1, `text` 12×3, `link` 8×1). `row` and `col` come together — both or neither. Layout patterns → the `dashboard` skill; read it before composing a canvas.
- **Dashboard cards that are not questions.** A dashcard carries exactly one content source: `card_id`, `text`, `heading`, `link` (`{url}` or `{entity: {type, id}}`), or `iframe`. `series` overlays extra saved questions on a question card. `tab_id` places it on a tab; new tabs may carry negative ids so dashcards can reference them.
- **Dashboard filters.** A filter is a `parameters` entry plus a mapping on every dashcard it filters — an unmapped parameter filters nothing. A parameter's `id` is a descriptive slug-like string you pick (`order_status`), unique within the dashboard; do not invent an opaque random one. `type` is a **closed enum**: string ops `string/=` `string/!=` `string/contains` `string/does-not-contain` `string/starts-with` `string/ends-with`; number ops `number/=` `number/!=` `number/between` `number/>=` `number/<=`; date `date/single` `date/range` `date/relative` `date/month-year` `date/quarter-year` `date/all-options`; location `location/city` `location/state` `location/zip_code` `location/country`; plus `category`, `id`, `boolean/=`, `temporal-unit`, and bare `number`/`text`/`date`/`boolean`. Each mapping in a dashcard's `parameter_mappings` takes `parameter_id` plus **exactly one** target: `target_field: <field-id>` for an MBQL card's column, `target_tag: "<tag>"` for a native card's template tag, or a raw `target` when you need the underlying form. Populate a dropdown with `values_source_type` (`"static-list"` + `values_source_config.values`, or `"card"` + `{card_id, value_field, label_field}`); omit it to pull live distinct values from the mapped field, which `get_parameter_values` reads back (with `constraints` to chain-filter against other selections).
- **Collections.** `browse_collection` addresses a collection by numeric id, 21-char entity id, `"root"` or `"trash"`; `mode: "tree"` covers content collections only, so trashed content is `{id: "trash"}` in the default `items` mode. `get_content` takes numeric ids. Archiving a collection takes its contents with it, and moving one moves everything inside it.
- **Snippets.** Absent from the search index — find them with `browse_collection` on a snippet folder, or `get_content`. Names are unique across snippets **including archived ones**, so a collision can come from a snippet no listing shows you.
- **Segments and measures.** `update` requires a non-blank `revision_message` (audit-logged; the server rejects an update without it). The `definition` is a single-stage MBQL 5 query (→ `mbql`): a segment holds filters, a measure holds the aggregation.
- **Timelines.** Collection-scoped annotations: a timeline's events render only on time-series questions saved in the **same collection** — sub-collections do not inherit, and events never draw on dashboard cards, only in the question view. To annotate a chart, create the timeline in that question's collection, then add events; an event draws only when its `timestamp` falls inside the chart's displayed range. An event needs `timeline_id`, `timestamp` (ISO 8601) and `time_matters` (true when the time of day is meaningful) — there is no default timeline, so create the timeline first. Deleting a timeline destroys every event on it; archive instead when in doubt. Read them back with `get_content`.
- **Metadata.** `update_field` takes a batch of `fields`: curating six columns is one call, and one bad `field_id` or unknown `semantic_type` names itself in a notice instead of failing the others. A foreign key needs **both** halves in the same edit — `semantic_type: "type/FK"` and `fk_target_field_id` — because a FK without a target is not joinable. `sync_schema` re-reads the warehouse's schema (new tables and columns appear); `rescan_values` refreshes the cached distinct values behind filter dropdowns. What each edit unlocks downstream → the `metadata` skill.
- **Transforms.** Iterate with `transform_write` `{method: "update"}` — never delete and re-create. The update keeps the row, its `entity_id`, its materialized table and its file name in git; a re-create earns a `_2` suffix and a noisy history. `pull` writes the saved source to a file when you don't already have it on disk (bare `.sql` for a plain-SQL transform, the `source` JSON otherwise). `delete` leaves the materialized output table standing (everything reading it keeps working) unless you pass `delete_target_table: true`. Creating a transform runs nothing: `transform_run` materializes it, waits, and hands back `target_table_id`. A failed run comes back carrying the server's own message — that is the answer; fix the source and run again, because a re-run of the same body fails the same way. (→ `transform`.)
- **Transform jobs.** A job does not name transforms — it carries **tags**, and runs every transform tagged with one of them plus their dependencies. Tagging a transform (`transform_write` with `tags`) is what puts it on a schedule; a job with no tags runs nothing. `schedule` is a **6-field Quartz cron** (`seconds minutes hours day-of-month month day-of-week`), so the five-field Unix expression is one field short: nightly at midnight is `"0 0 0 * * ?"`. Quartz forbids naming both day-of-month and day-of-week — exactly one of them is `?`.
- **Settings.** `value` is JSON of the setting's **own type**: a string is `"main"`, a boolean is `true`, a number is `42`, and `null` clears the setting back to its default. A setting fed by an environment variable cannot be written through the API — the refusal names the variable. Writing takes effect immediately for every user on the instance, and some (authentication, embedding) can lock people out, so read the current value first. An instance has hundreds of keys: `list` with a `filter` for the area you care about.
- **Git-sync.** Start every session with `{action: "status"}` — branch, local dirty items, whether the remote is ahead, and what is running are the four facts every other action depends on. Only collections marked for sync travel either way (`add_collection` / `remove_collection`, which cascade to descendants). `force` is **lossy**: on `import` it discards Metabase's uncommitted local changes, on `export` it overwrites the remote branch's history. A conflict means the same content changed on both sides — resolving it discards one side, so ask the user which one wins. (→ `git-sync`.)
- **Library.** The instance's shortlist of trusted data: a published table comes first in every data picker and ranks up in search. `publish` carries the table's **upstream** sources with it, `unpublish` carries its **downstream** dependents — both do more than the tables you name, so say what you are about to publish before publishing a whole database. `schema_ids` entries are written `"<database-id>:<schema>"` (`"1:public"`), never a bare name. Publishing needs **admin or data-analyst** (curate permission alone will not do it), and it does not put the Library's Data collection into the git-sync scope. Publish last, after the table is named, described and typed with `metadata_write`. What deserves publishing, and why each of those bites — read the `library` skill.
- **Search vs. browse.** For plain enumeration of a collection's contents or a database's tables, use `browse_collection` / `browse_data`. Reach for `search` when you are ranking against a query string or looking across resource types.
- **Copying beats recreating.** `duplicate_content` copies a question or dashboard in one call; reading an entity and rebuilding it by hand gets details wrong. A dashboard holding questions saved *inside* it cannot be copied shallowly — pass `is_deep_copy: true`, which also means edits to the copy leave the originals alone.
- **Documents.** `cards` mints new cards alongside the document, keyed by negative placeholder ids that a `cardEmbed` node references — for cards that exist **only** inside this document. A card that should be reusable is created with `question_write` and embedded by its real id. An `update` body replaces the whole tree, so edits start from `pull`, which writes the saved tree — `_id` anchors and all — to a file. `delete` destroys the document outright; cards it embedded by id are untouched. (→ `document`.)
- **Paging results.** `execute_query`, `execute_sql` and `run_saved_question` return up to `row_limit` rows (default 100, max 2000). The tools are stateless: page by calling again with the **same** query and an `offset`. When the whole result is the point, `run_saved_question`'s `export` writes it to a file instead of into this conversation.

## Specialized skills (load on demand)

This file is enough for any single-tool task. For anything deeper, read the relevant skill **proactively** — don't wing an MBQL body, a transform body, or the git-sync workflow from this overview.

- **`mbql`** — authoring/fixing any MBQL query body (`execute_query`'s `query`, a question's query, a transform's `source`, a segment/measure `definition`), and reading the errors a rejected one produces. The query-body reference.
- **`native-sql`** — authoring a native SQL query with parameters: template tags, field filters vs. raw variables, snippets, card references, and wiring a tag to a dashboard filter. The SQL fallback when MBQL cannot express it (`mbql` first).
- **`visualization`** — choosing a card's `display` and authoring `visualization_settings`. The presentation counterpart to `mbql`.
- **`dashboard`** — building interactive dashboards: wiring filters (parameters + mappings), linked/cascading filters, cross-filtering, click behavior, series, and tabs. Load beyond a plain card-layout task.
- **`metadata`** — setting field/table metadata: semantic types, foreign-key targets, dropdown/scan behavior, column visibility, and the downstream features each unlocks. Load when editing what a column _means_, not its data.
- **`transform`** — transform bodies, create + run, run inspection, tags, jobs.
- **`document`** — Metabase documents (TipTap body, embedding cards).
- **`git-sync`** — round-tripping content to/from a git remote.
- **`library`** — what to publish into the Library, and why the cascades bite.
- **`data-workflow`** — the guided, end-to-end data workflow: investigate raw data, build clean analysis-ready tables, define reusable segments/measures/metrics, answer questions, build dashboards. **Start here when the user states a goal rather than a single verb** — "make sense of my data", "build a data model", "go from raw data to a dashboard", "be my data analyst", "set up analytics for X". It detects where the data is and routes to the right stage.

If a task spans more than one, read each.

## Don't

- Don't ask the user for credentials or paste warehouse passwords into the conversation. The instance is already authenticated.
- Don't rebuild an entity you could copy, or hand-assemble a body a skill has the grammar for. A guessed body costs a rejection and a rewrite; the read is cheaper than the retry.
