---
name: core
description: Foundations for driving Metabase from the terminal with the `mb` CLI — authentication and named profiles, the flag/output/`--json` conventions every command shares, JSON body input, command discovery via `--help` (add `--json` for machine-readable schemas), and the per-resource footguns (db, table, field, upload, card, dashboard, collection, segment, measure, library, setting, search, eid). Load first for any `mb` task; it routes to the specialized skills for deeper work.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

# metabase-cli (core)

The official Metabase CLI (`mb`) drives a Metabase instance over its REST API: auth, list/get/create/update/delete on every resource, query and transform execution, content search, git-sync (representations ↔ instance), and entity-id translation.

Top-level command groups (run `mb <group> --help` to discover verbs):

```
auth | db | table | field | upload | query | card | dashboard | snippet | segment | measure | collection | library
document | transform | transform-job | transform-tag | setting | search | git-sync | setup | eid | uuid | upgrade | skills
```

The conventions below — auth, flags, output, body input — hold across **every** group. Per-command flags and examples live in each command's `--help`; add `--json` for the machine-readable form with the output JSON Schema. A few flows have their own skills (see "Specialized skills"). When a card needs a query, prefer MBQL over native SQL (portable, pre-flight-validated — load `mbql`); fall back to native SQL when MBQL can't express it.

## Auth & profiles

**The agent does not log in for the user.** Authentication is the human's job — they pick the base URL, paste credentials, and store them as a named profile. The agent checks what profiles exist, asks which to use, and passes `--profile <name>` through every command.

```bash
mb auth list --json                      # → {data:[{profile,url,authenticated,status,…}], returned, total}
mb auth status --json                    # → {profile, present, url} for the default profile
mb auth status --profile <name> --json   # health probe for one profile
```

`auth list` is the primary enumeration path — one call returns every profile with sanitized URL, an `authenticated` flag, and a probe `status` (`ok` / `auth-failed` / `network-error` / `server-error` / `not-probed`). Use it before asking which profile to pick.

- One profile and intent doesn't disambiguate → use it.
- Several → ask via `AskUserQuestion`, presenting the names from `auth list`.
- Empty `data: []` → ask the user to run `mb auth login` themselves and tell you the profile name.

Once a name is established, pass `--profile <name>` to **every** subsequent command. Profile names are arbitrary local labels (`prod`, `staging`).

## Flag conventions

**`--profile` is per-subcommand — it attaches after the full verb chain, not before it.**

```bash
✅ mb table list --profile prod --json
❌ mb --profile prod table list           # → error: "Unknown command prod"
```

**`--wait` for async operations.** `transform run`, `git-sync import`, and similar verbs return immediately by default. Pass `--wait` whenever the next step depends on completion — without it you race the operation and see "not ready" / transient connection refusals.

**Some "lookup" verbs return JSON envelopes, not bare values.** `mb setting get <key>` returns `{"key": "...", "value": ...}`. Extract before reusing:

```bash
VALUE=$(mb setting get <key> --json | jq -r '.value')
```

## Output

Every list/get verb supports the same output flags:

- `--json` — emit the full JSON envelope, safe for `jq`. Default is human-readable text.
- `--full` — include every field (the compact projection is the default, and is the agent-facing contract).
- `--fields a,b.c.d` — project specific dot-paths. Mutually exclusive with `--full`. **Paths are relative to each `data[]` item on list verbs, and to the root on single-item verbs.** So it's `--fields id,name` on `… list` / `database schema-tables` (`data.id` and `data[].id` both fail with `unknown field path: "data.id"`), and `--fields id,name,display` on `card get`, `--fields data.rows` on `mb query` (whose `data` is an object).
- `--max-bytes <n>` — cap **list** output size (drops trailing items, sets `truncated`). Default 24576 (sized to fit under agent-harness tool-output limits); `0` disables. Single-item commands (`get`) never truncate — when their output exceeds the cap they throw a `ConfigError` (exit 2: "output is N bytes, over the M-byte --max-bytes cap; …") whose tail names the remedy: on schema-shaped commands it is the exact narrower command to run instead — follow it rather than raising the cap.
- JSON output is a single line when stdout is piped (pretty-printed only at a TTY) — always parse it, never scrape by line position.

List envelope shape (metadata first, so counts and the truncation marker survive if a consumer cuts the tail):

```json
{
  "returned": 10,
  "total": 42,
  "limit": 50,
  "truncated": { "reason": "max_bytes", "bytes": 123456 },
  "data": [
    /* items */
  ]
}
```

`truncated` is present only when the cap dropped trailing items.

`total` is best-effort and may be `null` (empty / permissions-filtered collections, or `--limit` early-stop); use `returned` for the count you got and `data.length` for the rendered slice.

## Body input (create / update / run)

Verbs that take a payload accept it from one of four sources, **first non-empty wins**:

1. `--body '<inline JSON>'`
2. `--file <path>` — JSON file
3. stdin (auto-detected when piped, or explicit `--stdin` where supported)
4. positional argument

Exactly one required; passing two of `--body` / `--file` / `--stdin` is rejected with a `ConfigError`.

```bash
cat > ./.scratch/body.json <<'EOF'
{ ... }
EOF
mb <noun> create --file ./.scratch/body.json --profile <n> --json
```

Single-quoted `'EOF'` stops the shell interpolating `$vars` inside the JSON.

Write working files to **`./.scratch`** in the current directory (`mkdir -p ./.scratch` first), never `/tmp` — better permissions, they persist across the session, and the user can review them.

## Discovering commands and schemas

Cheapest source that answers the question wins:

- What groups/verbs exist? → `mb --help`, then `mb <group> --help`. Add `--json` for a machine-readable `{command, description}` index (`mb --help --json` lists every command).
- What flags does a command take? → `mb <command> --help` — flags with enums and defaults, examples, ~1 KB.
- Output JSON Schema before parsing, JSON-body input schema before authoring, machine-readable arg types, min server version? → `mb <command> --help --json` — that command's full entry (`inputSchema` is the exact validator the command runs on the body; `null` when it takes none).

```bash
mb card query --help                                    # flags, enums, defaults, examples
mb card list --help --json | jq .outputSchema           # output schema before parsing
mb card create --help --json | jq .inputSchema          # body schema before authoring
mb transform --help --json | jq -r '.commands[].command'  # verbs under "transform"
```

## Resource quirks worth memorizing

Routine verb shapes (list / get / create / update), every flag, and output schemas live in each command's `--help` (add `--json` for output schemas). Below is only what help does _not_ tell you: footguns and non-obvious behaviors.

- **db traversal: the hydration ladder.** Start with `database get <db-id> --include tables` — the compact table map (id, name, schema, description per table), one call that fits most databases. Pick the relevant tables, then `table fields <table-id>` per table (bounded: fields are per-table). `--include tables.fields` is the full rollup — small databases only; when either outgrows the cap the error message names the next command down the ladder. Hundreds of tables? Traverse by schema (`database schemas <db-id>` → `database schema-tables <db-id> <schema>`) or look tables up by name (`search <term> --models table --db-id <db-id> --limit 10`). `sync-schema` / `rescan-values` queue async work and return `{status:"ok"}` immediately; `sync-schema --wait` blocks until `initial_sync_status: complete`.
- **table fields.** `table get` never returns fields on its own — pass `--include fields` (compact; the underlying query_metadata response also carries FK targets and dimensions, visible under `--full`) or use `table fields <id>` (list envelope). `table update` patches table-level metadata only; physical columns aren't editable.
- **field has no `list`.** Fields are per-table — get them via `table get <id> --include fields`. Never enumerate fields across a whole db (context blow-up). `field summary` is live cardinality `{field_id, count, distincts}`; `field values` is the cached distinct set (`has_more_values: true` ⇒ truncated cache). `field update` patches metadata only (`base_type` isn't editable) — this is where you set a column's `semantic_type` or foreign-key target.
- **upload (CSV → tables).** `upload csv --file <path>` creates a new table + model (prints `{model_id, table_id}`); `upload append <table-id>` / `upload replace <table-id> --file <path>` add to / overwrite a table **previously created by upload** (columns must match). The destination db+schema is admin-configured, not per-call — check with `mb setting get uploads-settings --json` (`db_id: null` ⇒ uploads off/unconfigured; needs admin to read). `--collection <id|root>` only sets the model's collection. Max 50 MB. Errors: **"The uploads database is not configured."** = no db has uploads enabled; **"Uploads are not enabled."** = the append/replace target isn't an uploaded table.
- **card.** `dataset_query` is the **flat** `mbql/query` value, not a legacy `{type:"query",query:…}` envelope (→ `mbql`). `--export-format csv|xlsx` streams the raw export (pipe to a file), bypassing the JSON envelope. `archive` is the only delete; unarchive with `update --body '{"archived":false}'`. `visualization_settings` keys are scoped by `display` and aren't pre-flighted — see `visualization`.
- **dashboard.** Dashcards round-trip through `PUT /api/dashboard/:id` (no per-dashcard endpoint): `update-dashcard <dash-id> <dashcard-id>` patches one safely; `update --body '{"dashcards":[…]}'` replaces the whole set (omitted ids are deleted server-side; negative ids for new cards). `create` accepts the **same** `dashcards` array in its initial body — lay out the whole dashboard in one call: negative ids for new cards, and `card_id:null` plus a `visualization_settings.virtual_card` block (`{display:"text"|"heading"|"link"|…}`) for non-question cards. `create`/`update` pre-flight every positive `card_id` and exit **2** with `{ok:false,errors:[…]}` on a bad ref (non-bypassable). `dashboard get <id>` (or `--full`) hydrates dashcards/tabs; `list` omits them. **The grid is 24 columns wide:** each dashcard's `{col, row, size_x, size_y}` is in grid units — **full-width is `size_x: 24`** (`size_x: 12` is half a row, the usual cause of a card filling only half the width). Keep `col + size_x ≤ 24`, start a full-width stack's `col` at 0, and don't overlap (the server stores collisions as sent — no auto-fix). Layout patterns and per-chart default sizes → the `dashboard` skill; load it before composing any `dashcards` array.
- **dashboard parameters (filters).** A dashboard's `parameters` array holds its filter widgets; they're part of the dashboard record, so read them with `dashboard get <id> --fields parameters --json` (no separate verb). **Editing replaces the _whole_ array** (like dashcards), so it's a read-modify-write loop: pull the current set with `dashboard get <id> --fields parameters --json`, add/change entries, and send the full array back via `dashboard update --body '{"parameters":[…]}'` (or supply it in `create`). Omitting a parameter deletes it. Each parameter is `{id, type, …}`. **`id` is a descriptive slug-like string you pick (e.g. `order_status`), unique within this dashboard — Metabase stores any non-blank string verbatim. Do NOT invent a random/opaque id by guessing; reuse the `slug`. If you genuinely need an opaque id, mint one with `mb uuid` — never fabricate one.** `type` is a **closed enum**; an unlisted value is a hard parse error that echoes the full allowed set back to you: string ops `string/=` `string/!=` `string/contains` `string/does-not-contain` `string/starts-with` `string/ends-with`; number ops `number/=` `number/!=` `number/between` `number/>=` `number/<=`; date `date/single` `date/range` `date/relative` `date/month-year` `date/quarter-year` `date/all-options`; plus `category`, `id`, `boolean/=`, `temporal-unit`, and bare `number`/`text`/`date`/`boolean`. A parameter only filters a card once it is **mapped**: each dashcard's `parameter_mappings` is `[{parameter_id, target}]` where `parameter_id` must match a parameter's `id` exactly, and `target` is `["dimension", ["field", <field-id>, null]]` for an MBQL card column, `["dimension", ["template-tag", "<tag>"]]` for a native field-filter tag, or `["variable", ["template-tag", "<tag>"]]` for a native raw-value tag. Populate a dropdown with `values_source_type`: `"static-list"` + `values_source_config.values`, or `"card"` + `{card_id, value_field, label_field}`; omit it to pull live distinct values from the mapped field. `dashboard parameter-values <id> <parameter-id> [--query <substr>]` fetches those selectable values (`{values, has_more_values}`); `--query` is a case-insensitive substring search.
- **snippet `--archived` is a swap, not a union** — list returns _either_ active _or_ archived rows, never both. (Same for `--filter archived` on dashboard/collection.)
- **segment / measure.** `update` and `archive` require a non-blank `revision_message` (audit-logged); the CLI does not synthesize it on `update`. `archive` defaults to `"Archived via mb CLI"` — override with `--revision-message`. `definition` is a flat MBQL clause (→ `mbql`): segment = a filter, measure = exactly one aggregation.
- **collection `<ref>`** accepts four forms only — positive int, `root`, `trash`, or a 21-char entity_id; anything else is a client-side `ConfigError`. `collection items` auto-paginates (cap with `--limit`, which then omits `total`). `collection tree` is **JSON-only** (`--format text` is rejected). A transform collection needs `collection create --namespace transforms`.
- **setting set** parses the value as **strict JSON**: a string is `'"value"'` (inner quotes), booleans `true`/`false`, numbers bare. Wrong quoting silently errors — confirm with `setting get <key>` after. `setting get --json` works on every value type (wrapping bare-text responses into `{key, value}`).
- **search vs. list.** For plain enumeration of cards/dashboards/collections use the dedicated `… list` verbs; reach for `search --models <kind>` only for ranking against a query string or a cross-resource lookup.
- **transform.** Iterate with `transform update <id>`, never `delete` + `create` (keeps the row, `entity_id`, materialized table, and YAML filename — avoids `_2` suffixes and noisy git history). `transform run` needs `--wait` (or `--sync`, which also waits for the output table to register and returns `target_table_id`) or you get only `{run_id, final:null}`. (→ `transform`.)
- **setup is one-shot.** `mb setup` walks `/api/setup` for a **fresh** instance only — errors against an already-configured one. Mostly for bootstrapping local / e2e instances.
- **eid** translates a string entity id → numeric id: `mb eid --model <model> <eid1,eid2> --json`. Entity ids are NanoIDs that can start with `-`, which the positional form misreads as a flag (shell quotes don't help) — for those, use `--body '{"entity_ids":{"card":["-…"]}}'` (the id is a JSON string value, immune to flag parsing).
- **library.** EE-only (`library` premium feature, v59+). The Library is a curated subtree (`library-data` "Data" + `library-metrics` "Metrics" under a `library` root): tables published to **Data** appear first in data pickers and rank up in search; metrics saved to **Metrics** are prioritized in nav, search, and the query builder — it's how you tell people (and agents) "start from these, they're trusted." `library get` shows the Library and its Data/Metrics collection ids; `library create` provisions it (idempotent). `library publish --table-ids/--db-ids/--schemas` publishes tables into Data — it **resolves the Data collection itself and creates the Library if absent** (no collection id to find); each `--schemas` entry is `<db-id>:<schema>` (e.g. `1:public`), not a bare name. `publish` cascades to upstream FK dependencies, `unpublish` to downstream dependents; both need **admin or data-analyst** (Curate alone won't publish) and exit **403** without write **and** query permission on every affected table. Publish status shows on the table: `table get`/`table list` carry `is_published` (`collection_id` under `--full`). Good candidates are finished, analysis-ready tables — clean/combine via transforms first, then publish the polished result.
- **query / uuid.** `mb query` is the ad-hoc MBQL surface (`--print-schema` → `--dry-run` → run); `mb uuid --count <n>` mints the `lib/uuid` values MBQL clauses need. Both live in `mbql`.

## Specialized skills (load on demand)

This file is enough for any single-command task. For anything deeper, load the relevant skill **proactively** — don't wing an MBQL body, a transform body, or the git-sync workflow from this overview. Load via `mb skills get <name>`.

- **`mbql`** — authoring/fixing any MBQL query body (`mb query`, card `dataset_query`, transform `source.query`, measure/segment `definition`); reading `--dry-run` errors. The query-body reference.
- **`native-sql`** — authoring a native SQL `dataset_query` with parameters: template tags, field filters vs. raw variables, snippets, card references, and wiring a tag to a dashboard filter. The SQL fallback when MBQL can't express it (`mbql` first).
- **`visualization`** — choosing a card's `display` and authoring `visualization_settings`. The presentation counterpart to `mbql`.
- **`dashboard`** — building interactive dashboards: wiring filters (parameters + mappings), linked/cascading filters, cross-filtering, click behavior, series, and tabs. Load beyond a plain card-layout task.
- **`metadata`** — setting field/table metadata: semantic types, foreign-key targets, dropdown/scan behavior, and column visibility, and the downstream features each unlocks. Load when editing what a column _means_, not its data.
- **`transform`** — transform body JSON, create + run-with-wait, run inspection, tags, jobs.
- **`document`** — Metabase documents (TipTap body, embedding cards).
- **`git-sync`** — round-tripping content to/from a git remote.
- **`data-workflow`** — the guided, end-to-end data workflow: investigate raw data, build clean analysis-ready tables, define reusable segments/measures/metrics, answer questions, build dashboards. **Start here when the user states a goal rather than a single verb** — "make sense of my data", "build a data model", "go from raw data to a dashboard", "be my data analyst", "set up analytics for X". It detects where the data is and routes to the right stage.

If a task spans more than one, load each. `mb skills list` enumerates everything on the installed version.

## Don't

- Don't paste credentials or warehouse passwords in chat. Have the user run the storing command.
- Don't shell into `curl` against `/api/...` (or add an HTTP library) when a `mb <verb>` exists — that bypasses retries, schema validation, and credential redaction.
