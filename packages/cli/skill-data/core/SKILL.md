---
name: core
description: Foundations for driving Metabase from the terminal with the `mb` CLI — authentication and named profiles, the flag/output/`--json` conventions every command shares, JSON body input, command discovery via `--help` (add `--json` for machine-readable schemas), and the per-resource footguns (db, table, field, upload, card, dashboard, collection, segment, measure, timeline, alert, subscription, library, setting, search, eid). Load first for any `mb` task; it routes to the specialized skills for deeper work.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

# metabase-cli (core)

The official Metabase CLI (`mb`) drives a Metabase instance over its REST API: auth, list/get/create/update/delete on every resource, query and transform execution, content search, git-sync (representations ↔ instance), and entity-id translation.

Top-level command groups (run `mb <group> --help` to discover verbs):

```
auth | db | table | field | upload | query | card | dashboard | snippet | segment | measure | collection | library
document | timeline | timeline-event | transform | transform-job | transform-tag | alert | subscription | setting
search | git-sync | setup | eid | uuid | upgrade | skills
```

The conventions below — auth, flags, output, body input — hold across **every** group. Per-command flags and examples live in each command's `--help`; add `--json` for the machine-readable form with the output JSON Schema. A few flows have their own skills (see "Specialized skills"). When a card needs a query, prefer MBQL over native SQL (portable, pre-flight-validated — load `mbql`); fall back to native SQL when MBQL can't express it.

## Auth & profiles

**The agent does not log in for the user.** Authentication is the human's job — they pick the base URL, paste credentials, and store them as a named profile. The agent checks what profiles exist, asks which to use, and passes `--profile <name>` through every command.

```bash
mb auth list --json                      # → list envelope; data is [{profile,url,authenticated,status,…}]
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
- `--max-bytes <n>` — cap output size. Default 24576 (sized to fit under agent-harness tool-output limits); `0` disables. On a list it drops trailing items and sets `truncated` (see below). Single-item commands (`get`) never truncate — over the cap they throw a `ConfigError` (exit 2: "output is N bytes, over the M-byte --max-bytes cap; …") whose tail names the remedy: on schema-shaped commands it is the exact narrower command to run instead — follow it rather than raising the cap.
- JSON output is a single line when stdout is piped (pretty-printed only at a TTY) — always parse it, never scrape by line position.

## List windows and resumption

Every list verb takes `--limit <n>` (items this call returns) and `--offset <n>` (where the window starts, default `0`), and answers with one envelope, metadata first so the counts and the resumption point survive a cut tail: `{returned, offset, limit?, total, has_more, next_offset, truncated?, data}`. `truncated` is `{reason: "max_bytes", bytes: N}`.

- **`has_more` decides whether to keep going — never compare counts.** `total` is the server's count on endpoints that report one and `null` on those that don't, so arithmetic over it is not a termination condition.
- **To continue, pass `next_offset` back as `--offset`.** When `has_more` is true `next_offset` is past the offset you sent, so the loop advances; when false the walk is over and `next_offset` is `null`.
- **`truncated` means the byte cap cut the output, not that the data ran out.** `has_more`/`next_offset` are recomputed to the cut point, so a capped list resumes like any window. Its `bytes` is what the untruncated answer would have measured, so it sizes the work left rather than the reply you hold. Narrow rows with `--fields` rather than raising `--max-bytes` — a bigger cap spends context on fields you didn't ask for, and the cap counts only what you asked for, so `--fields` buys rows directly. A capped list always returns at least one row; when not even one fits it exits 2 with "the smallest response this list can produce is N bytes, over the M-byte --max-bytes cap; …".
- `limit` is echoed only when you passed `--limit` — except `mb search`, which defaults to `--limit 20` (an unbounded search is expensive server-side) and so always reports one. On nouns the server doesn't page, one large `--limit` with narrow `--fields` is a single request; many small `--offset` hops are one request each.

The whole walk, literally:

```bash
offset=0
while : ; do
  out=$(mb table list --db-id 1 --limit 50 --offset "$offset" --fields id,name --profile <n> --json)
  echo "$out" | jq -c '.data[]'
  [ "$(echo "$out" | jq -r '.has_more')" = "true" ] || break
  offset=$(echo "$out" | jq -r '.next_offset')
done
```

## Body input (create / update / run)

Verbs that take a payload accept it from one of four sources, **first non-empty wins**:

1. `--body '<inline JSON>'`
2. `--file <path>` — JSON file
3. stdin (auto-detected when piped; `--file -` names it explicitly)
4. positional argument

Exactly one required; passing more than one of `--body` / `--file` / a positional argument is rejected with a `ConfigError`.

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

- **db traversal: the hydration ladder.** Start with `database get <db-id> --include tables` — the compact table map (id, name, schema, description per table), one call that fits most databases. Pick the relevant tables, then `table fields <table-id>` per table (bounded: fields are per-table). `--include tables.fields` is the full rollup — small databases only. Hundreds of tables? Traverse by schema (`database schemas <db-id>` → `database schema-tables <db-id> <schema>`) or look tables up by name (`search <term> --models table --db-id <db-id> --limit 10`). `sync-schema` / `rescan-values` queue async work and return `{status:"ok"}` immediately; `sync-schema --wait` blocks until `initial_sync_status: complete`.
- **table fields.** `table get` never returns fields on its own — pass `--include fields` (compact; the underlying query_metadata response also carries FK targets and dimensions, visible under `--full`) or use `table fields <id>` (list envelope). `table update` patches table-level metadata only; physical columns aren't editable.
- **field has no `list`.** Fields are per-table — get them via `table get <id> --include fields`. Never enumerate fields across a whole db (context blow-up). `field summary` is live cardinality `{field_id, count, distincts}`; `field values` is the cached distinct set (`has_more_values: true` ⇒ truncated cache). `field update` patches metadata only (`base_type` isn't editable) — this is where you set a column's `semantic_type` or foreign-key target.
- **upload (CSV → tables).** `upload csv --file <path>` creates a new table + model (prints `{model_id, table_id}`); `upload append <table-id>` / `upload replace <table-id> --file <path>` add to / overwrite a table **previously created by upload** (columns must match). The destination db+schema is admin-configured, not per-call — check with `mb setting get uploads-settings --json` (`db_id: null` ⇒ uploads off/unconfigured; needs admin to read). `--collection <id|root>` only sets the model's collection. Max 50 MB. Errors: **"The uploads database is not configured."** = no db has uploads enabled; **"Uploads are not enabled."** = the append/replace target isn't an uploaded table.
- **card.** `dataset_query` is the **flat** `mbql/query` value, not a legacy `{type:"query",query:…}` envelope (→ `mbql`). `--export-format csv|xlsx` streams the raw export (pipe to a file), bypassing the JSON envelope. `archive` is the only delete; unarchive with `update --body '{"archived":false}'`. `visualization_settings` keys are scoped by `display` and aren't pre-flighted — see `visualization`.
- **dashboard.** Dashcards round-trip through `PUT /api/dashboard/:id` (no per-dashcard endpoint): `update-dashcard <dash-id> <dashcard-id>` patches one safely; `update --body '{"dashcards":[…]}'` replaces the whole set (omitted ids are deleted server-side; negative ids for new cards). `create` accepts the **same** `dashcards` array in its initial body — lay out the whole dashboard in one call: negative ids for new cards, and `card_id:null` plus a `visualization_settings.virtual_card` block (`{display:"text"|"heading"|"link"|…}`) for non-question cards. `create`/`update` pre-flight every positive `card_id` and exit **2** with `{ok:false,errors:[…]}` on a bad ref (non-bypassable). `dashboard get <id>` (or `--full`) hydrates dashcards/tabs; `list` omits them. **The grid is 24 columns wide:** each dashcard's `{col, row, size_x, size_y}` is in grid units — **full-width is `size_x: 24`** (`size_x: 12` is half a row, the usual cause of a card filling only half the width). Keep `col + size_x ≤ 24`, start a full-width stack's `col` at 0, and don't overlap (the server stores collisions as sent — no auto-fix). Layout patterns and per-chart default sizes → the `dashboard` skill; load it before composing any `dashcards` array.
- **dashboard parameters (filters).** A dashboard's `parameters` array holds its filter widgets; they're part of the dashboard record, so read them with `dashboard get <id> --fields parameters --json` (no separate verb). **Editing replaces the _whole_ array** (like dashcards), so it's a read-modify-write loop and omitting a parameter deletes it. A parameter only filters a card once it is **mapped** onto that dashcard's `parameter_mappings` — an unmapped parameter is an inert widget. `type` is a **closed enum**; an unlisted value is a hard parse error that echoes the full allowed set back to you. `dashboard parameter-values <id> <parameter-id> [--query <substr>]` fetches a widget's selectable values (`{values, has_more_values}`; `--query` is a case-insensitive substring search). Parameter types, ids, mapping targets, and value sources → the `dashboard` skill; load it before authoring a `parameters` array.
- **alert / subscription are two unrelated systems.** `alert` watches one **card** and fires on a send condition (`/api/notification`: a cron string, `channel/email`-prefixed handlers, typed recipients); `subscription` delivers one **dashboard** on a schedule (`/api/pulse`: structured `schedule_type` + hour/day/frame, bare `email` channels, `{id}|{email}` recipients). The bodies are not interchangeable. Both silently deliver nowhere if the server has no SMTP / Slack app — check `mb setting get 'email-configured?'` (quote it; the `?` is a shell glob) before creating either. Their list-valued fields (`handlers`/`subscriptions`, `channels`/`cards`) **replace wholesale** on update, so adding one recipient is a read-modify-write. `mb card alerts <id>` and `mb dashboard subscriptions <id>` list what's already attached to a card/dashboard; `archive` deactivates rather than deletes. Load the `notification` skill before authoring either body.
- **snippet `--archived` is a swap, not a union** — list returns _either_ active _or_ archived rows, never both. (Same for `--filter archived` on dashboard/collection.)
- **segment / measure.** `update` and `archive` require a non-blank `revision_message` (audit-logged); the CLI does not synthesize it on `update`. `archive` defaults to `"Archived via mb CLI"` — override with `--revision-message`. `definition` is a flat MBQL clause (→ `mbql`): segment = a filter, measure = exactly one aggregation.
- **timeline / timeline-event.** Timelines are collection-scoped event annotations for time-series charts: a timeline's events render only on time-series questions saved in the **same collection** (`collection_id`; null = root) — sub-collections do **not** inherit, and events never draw on dashboard cards, only in the question (and collection) view. To annotate a question's chart, create the timeline in that question's collection, then add events; an event only draws when its `timestamp` falls inside the chart's displayed time range. Event `create` requires `timestamp` (ISO 8601), `timezone` (IANA name), `time_matters` (true = the time of day is significant, false = date-only), and `timeline_id` — the API never auto-creates a default timeline (that's UI-only). There is no `timeline-event list`; enumerate with `timeline events <id>` (`--archived` to include archived). Archiving a timeline cascades `archived` to its events; `delete` is a **hard** delete of the timeline and all its events — prefer `archive`.
- **collection `<ref>`** accepts four forms only — positive int, `root`, `trash`, or a 21-char entity_id; anything else is a client-side `ConfigError`. `collection items` pages the server endpoint, pulling only as far as the output cap can show — read `has_more`/`next_offset` to continue. `collection tree` is **JSON-only** (`--format text` is rejected). A transform collection needs `collection create --namespace transforms`.
- **setting set** parses the value as **strict JSON**: a string is `'"value"'` (inner quotes), booleans `true`/`false`, numbers bare. Wrong quoting silently errors — confirm with `setting get <key>` after. `setting get --json` works on every value type (wrapping bare-text responses into `{key, value}`).
- **search vs. list.** For plain enumeration of cards/dashboards/collections use the dedicated `… list` verbs; reach for `search --models <kind>` only for ranking against a query string or a cross-resource lookup.
- **transform.** Iterate with `transform update <id>`, never `delete` + `create` (keeps the row, `entity_id`, materialized table, and YAML filename — avoids `_2` suffixes and noisy git history). `transform run` needs `--wait` (or `--sync`, which also waits for the output table to register and returns `target_table_id`) or you get only `{run_id, final:null}`. (→ `transform`.)
- **setup is one-shot.** `mb setup` walks `/api/setup` for a **fresh** instance only — errors against an already-configured one. Mostly for bootstrapping local / e2e instances.
- **eid** translates a string entity id → numeric id: `mb eid --model <model> <eid1,eid2> --json`. Entity ids are NanoIDs that can start with `-`, which the positional form misreads as a flag (shell quotes don't help) — for those, use `--body '{"entity_ids":{"card":["-…"]}}'` (the id is a JSON string value, immune to flag parsing).
- **library.** EE-only (`library` premium feature, v59+). The Library is a curated subtree (`library-data` "Data" + `library-metrics` "Metrics" under a `library` root): tables published to **Data** appear first in data pickers and rank up in search; metrics saved to **Metrics** are prioritized in nav, search, and the query builder — it's how you tell people (and agents) "start from these, they're trusted." `library get` shows the Library and its Data/Metrics collection ids; `library create` provisions it (idempotent). `library publish --table-ids/--db-ids/--schemas` publishes tables into Data — it **resolves the Data collection itself and creates the Library if absent** (no collection id to find); each `--schemas` entry is `<db-id>:<schema>` (e.g. `1:public`), not a bare name. `publish` cascades to upstream FK dependencies, `unpublish` to downstream dependents; both need **admin or data-analyst** (Curate alone won't publish) and exit **403** without write **and** query permission on every affected table. Publish status shows on the table: `table get`/`table list` carry `is_published` (`collection_id` under `--full`). Good candidates are finished, analysis-ready tables — clean/combine via transforms first, then publish the polished result. Publishing does not put the Data collection in the git-sync scope: on a remote-sync instance, `mb git-sync add-collection <data-collection-id>` is what makes exports carry the published tables' metadata (see the `git-sync` skill).
- **query / uuid.** `mb query` is the ad-hoc MBQL surface (`--print-schema` → `--dry-run` → run); `mb uuid --count <n>` mints the `lib/uuid` values MBQL clauses need. Both live in `mbql`.

## Specialized skills (load on demand)

This file is enough for any single-command task. For anything deeper, load the relevant skill **proactively** — don't wing an MBQL body, a transform body, or the git-sync workflow from this overview. Load via `mb skills get <name>`.

- **`mbql`** — authoring/fixing any MBQL query body (`mb query`, card `dataset_query`, transform `source.query`, measure/segment `definition`); reading `--dry-run` errors. The query-body reference.
- **`native-sql`** — authoring a native SQL `dataset_query` with parameters: template tags, field filters vs. raw variables, snippets, card references, and wiring a tag to a dashboard filter. The SQL fallback when MBQL can't express it (`mbql` first).
- **`visualization`** — choosing a card's `display` and authoring `visualization_settings`. The presentation counterpart to `mbql`.
- **`dashboard`** — building interactive dashboards: wiring filters (parameters + mappings), linked/cascading filters, cross-filtering, click behavior, series, and tabs. Load beyond a plain card-layout task.
- **`metadata`** — setting field/table metadata: semantic types, foreign-key targets, dropdown/scan behavior, and column visibility, and the downstream features each unlocks. Load when editing what a column _means_, not its data.
- **`notification`** — scheduled delivery: question alerts (`mb alert`) and dashboard subscriptions (`mb subscription`). Choosing between them, the two schedule/recipient contracts, channel prerequisites, testing a send.
- **`transform`** — transform body JSON, create + run-with-wait, run inspection, tags, jobs.
- **`document`** — Metabase documents (TipTap body, embedding cards).
- **`git-sync`** — round-tripping content to/from a git remote.
- **`data-workflow`** — the guided, end-to-end data workflow: investigate raw data, build clean analysis-ready tables, define reusable segments/measures/metrics, answer questions, build dashboards. **Start here when the user states a goal rather than a single verb** — "make sense of my data", "build a data model", "go from raw data to a dashboard", "be my data analyst", "set up analytics for X". It detects where the data is and routes to the right stage.

If a task spans more than one, load each. `mb skills list` enumerates everything on the installed version.

## Don't

- Don't paste credentials or warehouse passwords in chat. Have the user run the storing command.
- Don't shell into `curl` against `/api/...` (or add an HTTP library) when a `mb <verb>` exists — that bypasses retries, schema validation, and credential redaction.
