---
name: core
description: Drive a Metabase instance from the terminal via the `mb` CLI — auth, databases, cards, dashboards, documents, collections, transforms, queries, search, git-sync. Use for any `mb verb` task.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

# metabase-cli (core)

The official Metabase CLI (`mb`) drives a Metabase instance over its REST API. It covers auth, list/get/create/update/delete on every resource, query and transform execution, content search, git-sync (representations ↔ instance), and entity-id translation.

Top-level command groups (run `mb <group> --help` to discover verbs):

```
auth | db | table | field | query | card | dashboard | snippet | segment | measure | collection
document | transform | transform-job | setting | search | git-sync | setup | eid | uuid | upgrade | skills
```

The patterns below — auth, flag conventions, output flags, body input — apply across **every** group. Per-command flags, examples, and output schemas live in `mb __manifest` (see below). A few flows have their own specialized skills; load them on demand (see "Specialized skills"). Authoring any query body (cards, transforms, measures, segments, ad-hoc `mb query`) is one — load `mbql` whenever you build MBQL by hand. When a **question** (card) needs a query, prefer MBQL over native SQL — it's portable across warehouse engines and the CLI pre-flight-validates it. Try it first, but don't force it: fall back to native SQL when MBQL can't express the query, or when an MBQL body keeps failing server-side and you can't resolve it.

## Auth & profiles

**The agent does not log in for the user.** Authentication is the human's job — they pick the base URL, paste credentials, and store them as a named profile. The agent's role is to _check_ what profiles exist, _ask_ which to use, and pass `--profile <name>` through every command.

### Discover what's already configured

```bash
mb auth list --json                      # → {data: [{profile, url, authenticated, status, …}], returned, total}
mb auth status --json                    # → {profile, present, url} for the default profile
mb auth status --profile <name> --json   # → status of a specific profile
```

`auth list` is the primary enumeration path — one call returns every configured profile with sanitized URL, an `authenticated` flag, and a probe `status` (`ok` / `auth-failed` / `network-error` / `server-error` / `not-probed`). Use it before asking the user which profile to pick. If it returns an empty `data: []`, ask the user to run `mb auth login` themselves (see the policy above) and tell you the profile name. `auth status` is a single-profile health probe when you already know the name.

### Pick the profile to use

If exactly one profile is configured and the user's intent doesn't disambiguate, use it. If multiple profiles exist and the user hasn't named one, ask via `AskUserQuestion`, presenting the names from `auth list`. Once a name is established, pass `--profile <name>` to **every** subsequent command. Profile names are arbitrary local labels — `prod`, `staging` — let the user pick.

## Flag conventions

### `--profile` is per-subcommand, not global

```bash
✅ mb table list --profile prod --json
❌ mb --profile prod table list           # → error: "Unknown command prod"
```

`--profile` attaches **after** the full verb chain (`table list`, `card get`, `git-sync export`).

### `--wait` for async operations

`transform run`, `git-sync import`, and similar async verbs return immediately by default. Pass `--wait` for any interactive flow where the next step depends on completion. Without it you'll race the operation and see "not ready" / transient connection refusals.

### Some outputs are JSON envelopes, not bare strings

A handful of "lookup" verbs return a JSON object even when you only want a single field. `mb setting get <key>` returns `{"key": "...", "value": ...}`, not the bare value. Don't drop them raw into another flag — extract:

```bash
VALUE=$(mb setting get <key> --json | jq -r '.value')
```

If you find yourself piping a `--json` envelope straight into another flag and the receiving command rejects it, this is what happened.

## Output

Every list/get verb supports the same output flags:

- `--json` — emit the full JSON envelope, safe for `jq`. Default is human-readable text.
- `--full` — include every field (compact projection is the default for list/get).
- `--fields a,b.c.d` — project specific dot-paths. Mutually exclusive with `--full`. **Paths are relative to each `data[]` item on list verbs, and to the root on single-item verbs.** So it's `--fields id,name` on `… list` / `database schema-tables` (the projection runs per row) — `data.id` and `data[].id` both fail with `unknown field path: "data.id"`. On single-object verbs the path is root-relative: `--fields id,name,display` on `card get`, and `--fields data.rows` on `mb query` (whose `data` is an object, not an array).
- `--max-bytes <n>` — cap **list** output size (drops trailing items, sets `truncated`). Default 65 536; `0` disables. Single-item commands (`get`, `metadata`) never truncate — they emit a stderr advisory when over the cap.

List envelope shape:

```json
{
  "data": [
    /* items */
  ],
  "returned": 10,
  "total": 42,
  "limit": 50,
  "truncated": false
}
```

The compact item projection is the agent-facing contract — add `--full` for all Metabase fields. `total` is best-effort and may be `null` (empty / permissions-filtered collections, or `--limit` early-stop); use `returned` for the count you got and `data.length` for the rendered slice.

## Body input (create / update / run)

Verbs that take a payload accept it from one of four sources, **first non-empty wins**:

1. `--body '<inline JSON>'`
2. `--file <path>` — JSON file
3. stdin (auto-detected when piped, or explicit `--stdin` where supported)
4. positional argument

Picking exactly one is required; passing two of `--body` + `--file` + `--stdin` is rejected with a `ConfigError`.

```bash
cat > /tmp/body.json <<'EOF'
{ ... }
EOF
mb <noun> create --file /tmp/body.json --profile <n> --json
```

Single-quoted `'EOF'` prevents the shell from interpolating `$vars` inside the JSON.

## Discover the full surface: `mb __manifest`

For the canonical, machine-readable inventory of every command — name, description, per-command `details`, examples, every flag with type and default, and the output JSON Schema — run:

```bash
mb __manifest
```

The leading `__` hides it from `--help`, but it's stable. Reach for it instead of `--help` per command. It pairs with `jq`:

```bash
mb __manifest | jq -r '.commands[].command'                                                  # every command name
mb __manifest | jq -r '.commands[] | select(.command | startswith("transform")) | .command'  # verbs under "transform"
mb __manifest | jq '.commands[] | select(.command == "card query") | .args'                  # flags + types for a command
mb __manifest | jq '.commands[] | select(.command == "card list") | .outputSchema'           # output schema before parsing
```

Use it to (a) enumerate verbs, (b) validate flag names before constructing a command, (c) read an output schema before parsing.

## Resource quirks worth memorizing

Routine verb shapes (list / get / create / update), every flag, and output JSON Schemas live in `mb __manifest` — pull them on demand. Below is only what the manifest does _not_ tell you: the footguns and non-obvious behaviors.

- **db traversal vs. rollup.** Default to granular: `database list` → `database schemas <db-id>` → `database schema-tables <db-id> <schema>` → `table get <table-id> --include fields`. The rollup endpoints (`database get --include tables.fields`, `database metadata <db-id>`) pull megabytes and blow the context window on any real warehouse — use them only on a small/dev db. `sync-schema` / `rescan-values` queue async work and return `{status:"ok"}` immediately; `sync-schema --wait` blocks until `initial_sync_status: complete`.
- **table fields.** `table get` never returns fields on its own — pass `--include fields` (compact) or use `table fields <id>` (list envelope). `table metadata <id>` adds FKs + dimensions (heavier). `table update` patches table-level metadata only; physical columns aren't editable here.
- **field has no `list`.** Fields are per-table — get them via `table get <id> --include fields`. Never enumerate fields across a whole db (context blow-up). `field summary` is live cardinality `{field_id, count, distincts}`; `field values` is the cached distinct set (`has_more_values: true` ⇒ truncated cache). `field update` patches metadata only; `base_type` isn't editable.
- **card.** `dataset_query` is the **flat** `mbql/query` value, not a legacy `{type:"query",query:…}` envelope (→ `mbql` skill). `--export-format csv|xlsx` streams the raw export (pipe to a file), bypassing the JSON envelope. `archive` is the only delete; unarchive with `update --body '{"archived":false}'`. `visualization_settings` keys are scoped by `display` and aren't pre-flighted — see the `viz` skill.
- **dashboard.** Dashcards round-trip through `PUT /api/dashboard/:id` (no per-dashcard endpoint): `update-dashcard <dash-id> <dashcard-id>` patches one safely; `update --body '{"dashcards":[…]}'` replaces the whole set (omitted ids are deleted server-side; use negative ids for new cards). `create` accepts the **same** `dashcards` array in its initial body, so you can lay out the whole dashboard in one call — negative ids for new cards, and `card_id:null` plus a `visualization_settings.virtual_card` block (`{display:"text"|"heading"|"link"|…}`) for non-question cards. `create`/`update` pre-flight every positive `card_id` against live server state and exit **2** with `{ok:false,errors:[…]}` on a bad ref — non-bypassable (no `--skip-validate`). `dashboard get <id>` (or `--full`) hydrates dashcards/tabs; `list` omits them. **Dashcard geometry: the grid is 24 columns wide.** Each dashcard's `{col, row, size_x, size_y}` is in grid units — `col` (0-indexed, left edge) and `size_x` are columns, `row`/`size_y` are rows; **full-width is `size_x: 24`** (`size_x: 12` is half a row — the usual cause of a card that only fills half the width, since it's a common per-chart default). Keep `col + size_x ≤ 24`, start each card's `col` at 0 for a full-width stack, and don't overlap cards (the server stores whatever you send — it won't auto-fix collisions).
- **snippet `--archived` is a swap, not a union** — list returns _either_ active _or_ archived rows, never both. (Same shape for `--filter archived` on dashboard/collection.)
- **segment / measure** `update` and `archive` require a non-blank `revision_message` (audit-logged); the CLI does not synthesize it on `update`. `archive` defaults to `"Archived via mb CLI"` — override with `--revision-message`. `definition` is a flat MBQL clause (→ `mbql` skill): segment = a filter, measure = exactly one aggregation.
- **collection `<ref>`** accepts four forms only — positive int, `root`, `trash`, or a 21-char entity_id — anything else is a client-side `ConfigError`. `collection items` auto-paginates (cap with `--limit`, which then omits `total`). `collection tree` is **JSON-only** — `--format text` is rejected.
- **setting set** parses the value as **strict JSON**: a string is `'"value"'` (inner quotes), booleans `true`/`false`, numbers bare. Wrong quoting silently errors — confirm with `setting get <key>` after. `setting get --json` works on every value type (it wraps bare-text responses into `{key, value}`).
- **search vs. list.** For plain enumeration of cards/dashboards/collections use the dedicated `… list` verbs; reach for `search --models <kind>` only for ranking against a query string or a cross-resource lookup.
- **transform.** Iterate with `transform update <id>`, never `delete` + `create` — keeps the row, `entity_id`, materialized table, and YAML filename (avoids `_2` suffixes and noisy git history). `transform run` needs `--wait` (or `--sync`, which also waits for the run's output table to register and returns `target_table_id`) or you get only `{run_id, final:null}`. (→ `transform` skill.)
- **setup is one-shot.** `mb setup` walks `/api/setup` for a **fresh** instance only — it errors against an already-configured one. Mostly for bootstrapping local / e2e instances.
- **eid** translates a string entity id → numeric id: `mb eid --model <model> <eid1,eid2> --json` (EIDs are a positional used with `--model`; or pass `--body '{"entity_ids":{"card":["…"]}}'`). Entity ids are NanoIDs that can start with `-`, which the positional form misreads as a flag (shell quotes don't help — the `-` survives into argv). For an id that may start with `-`, use `--body` — the id is a JSON string value, immune to flag parsing: `mb eid --body '{"entity_ids":{"card":["-…"]}}'`. Useful when an external system hands you an entity id and a verb needs the numeric one.
- **query / uuid.** `mb query` is the ad-hoc MBQL surface (`--print-schema` → `--dry-run` → run); `mb uuid --count <n>` mints the `lib/uuid` values every MBQL 5 clause needs. Both workflows live in the `mbql` skill.

## Specialized skills (load on demand)

This core file is enough for any single-command task. Load the relevant skill **proactively** when intent matches — don't wing an MBQL body, a transform body, or the git-sync workflow from this overview alone. Load each via `mb skills get <name>`.

- **`mbql`** — authoring or fixing any MBQL query body: `mb query`, a card `dataset_query`, a transform `source.query`, a measure/segment `definition`, "aggregate and group by", reading `--dry-run` errors. The query-body reference.
- **`viz`** — choosing a card's `display` and authoring `visualization_settings`: "make it a bar chart", "set the pie dimension/metric", "format this column as currency", "the card renders as a table instead of a chart". The presentation counterpart to `mbql`.
- **`transform`** — "create a transform", "run a transform", authoring transform body JSON, run inspection.
- **`data-transformation`** — the higher-level workflow: turning a raw, normalized source database into a small set of clean, wide, analysis-ready tables for a non-technical user — "clean up", "flatten", "denormalize", "make sense of this database", "build analysis-ready tables". Wraps `transform` (the mechanics) with the investigate → propose → build flow.
- **`semantic-layer`** — turning clean tables into reusable definitions: "make this filter reusable", "define active customers / net revenue / MRR officially", "create a segment / measure / metric", "so everyone uses the same definition". Builds on `mbql` (the definition bodies) and `transform` (widen a table first when a definition needs more than one).
- **`robot-data-engineer`** — the front-door router for the whole journey (raw data → clean tables → reusable definitions → dashboards) for a non-technical user: "make sense of my data", "build a data model", "go from raw data to a dashboard", "be my data analyst". Detects where the user is and routes to `data-transformation` / `semantic-layer` / `visualization`. (Working title — name TBD.)
- **`git-sync`** — "import the latest changes", "export to git", "git sync", "dirty check", "stash before pulling".

If a task spans more than one, load each. Specialized skills assume the conventions above and won't repeat them. `mb skills list` enumerates everything on the installed version.

## Don't

- **Don't run `mb auth login` for the user** — authentication is theirs (see §Auth).
- Don't paste credentials or warehouse passwords in chat. Have the user run the storing command.
- Don't put `--profile` before the verb chain — the CLI parses it as a subcommand and errors out.
- Don't omit `--wait` on `transform run` / `git-sync import` for interactive flows; the next step will race the operation.
- Don't drop a JSON-envelope verb's output raw into another flag. Extract with `--json | jq -r '.<field>'`.
- Don't add a third-party HTTP library or shell into `curl` against `/api/...` when a `mb <verb>` exists — that bypasses retries, schema validation, and credential redaction.
