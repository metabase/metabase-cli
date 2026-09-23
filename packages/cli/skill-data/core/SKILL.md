---
name: core
description: The entry point for working on a Metabase repository with the `mb` CLI inside Metabase RDE. Content is YAML files in this repository; the loop is read the schema, write the file, `mb validate`, commit and push, `mb git-sync import`, prove it on the instance. Covers what is a file and what is a command, the flag, output and list-window conventions, body input, command discovery, per-resource footguns, and an index of the other skills. Load first for any `mb` task.
allowed-tools: Read, Write, Edit, Bash, AskUserQuestion
---

# core

The `mb` CLI talks to the Metabase connected to this session: it reads every resource, runs queries, transforms and transform tests, searches, translates entity ids, validates repository content, extracts database metadata, puts a branch into Metabase, and serves these skills. It is on `PATH`, and its credential comes from the environment the app sets (`MB_URL` and the app's token broker). Never pass a URL or a key, and never ask the user to log in.

```
db | table | field | card | dashboard | collection | library | document | snippet | segment | measure
transform | transform-job | transform-tag | transform-test | query | search | git-sync
metadata | validate | entity-id | eid | uuid | skills
```

## Content is files

A collection, card, dashboard, document, segment, measure, snippet, transform, transform tag, transform job and Python library is a YAML file in this repository, in the representation format. No command creates, updates, archives or deletes one. What reaches Metabase is what the branch holds.

## The loop

1. **Understand the schema.** Discover it on the instance, database to schema to table to field: `mb db list`, `mb db get <id> --include tables`, then `mb table get <id> --include fields` per table on the question's path (the ladder is under Resource quirks). Profile with `mb field summary <id>`, `mb field values <id>` and `mb query`.
2. **Write or change YAML** in the checkout (`metabase-representation-format`). Mint ids with `mb entity-id`. Reference tables and fields by natural key, collections and cards by `entity_id`, users by email.
3. **`mb validate`** on the changed files, or on the whole tree. Fix every error; it is the fast, offline check.
4. **Commit and push** the session branch with `git`.
5. **`mb git-sync import --branch <branch> --wait`.** After it, the connected Metabase holds the branch's content. A `conflict` or `errored` task carries the server's message in the command's JSON; read it, fix the file, and go again from 3. Before importing, read the `git-sync` skill's branch guard.
6. **Prove it on the instance.** Find the numeric id with `mb eid --model <model> <entity_id>` or `mb <noun> list`, then `mb transform run <id> --wait` and `mb transform get-run`, `mb transform-test run <id>`, `mb card query <id>`, `mb dashboard get <id>`.
7. **Iterate from 2.** When the work is done the user opens the pull request; merging it into the tracked branch and importing that is the reviewer's step.

`mb validate` is structural. A file that passes can still name a table the instance lacks or hold a query that fails; steps 5 and 6 catch those.

## What is a command

| Need                           | Command                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read the instance              | `card list\|get`, `dashboard list\|get\|cards\|parameter-values`, `collection list\|get\|items\|tree`, `db list\|get\|schemas\|schema-tables`, `table list\|get\|fields`, `field get\|values\|summary`, `segment\|measure\|snippet\|document list\|get`, `transform list\|get\|dependencies`, `transform-job list\|get\|transforms`, `transform-tag list`, `library get`, `search`, `eid` |
| Run things                     | `query`, `card query`, `transform run\|cancel\|get-run\|runs`, `transform-job run`, `transform-test run`                                                                                                                                                                                                                                                                                  |
| Transform tests                | `transform-test list\|get\|create\|update\|delete\|run`; tests have no file form, so they are the one write family                                                                                                                                                                                                                                                                        |
| Publish a table to the Library | `library publish\|unpublish`                                                                                                                                                                                                                                                                                                                                                              |
| Database metadata              | `db sync-schema`, `db rescan-values`                                                                                                                                                                                                                                                                                                                                                      |
| Put a branch into Metabase     | `git-sync import`, plus `status\|is-dirty\|has-remote-changes\|dirty\|current-task\|cancel-task\|wait\|branches`                                                                                                                                                                                                                                                                          |
| Check files                    | `validate [path…]`                                                                                                                                                                                                                                                                                                                                                                        |
| Ids                            | `entity-id [--count N]` for a new file's `entity_id`, `uuid [--count N]` for an MBQL `lib/uuid` or a parameter id                                                                                                                                                                                                                                                                         |

Per-command flags and examples live in each command's `--help`; `--help --json` adds the output JSON Schema.

## Flags and output

- **`--wait` for async work.** `transform run`, `db sync-schema` and similar return immediately by default; pass `--wait` whenever the next step depends on completion. `git-sync import` waits by default.
- **Output flags go after the verb chain**: `mb table list --json`.
- `--json` emits the full JSON envelope, single-line when piped. Default is text at a TTY and JSON when piped. Parse it; never scrape by line position. JSON goes to stdout and notices to stderr, so never `2>&1` into a parser.
- `--full` includes every field; the compact projection is the default and the agent-facing contract.
- `--fields a,b.c` projects dot-paths, relative to each `data[]` item on list verbs and to the root on single-item verbs: `--fields id,name` on `… list`, `--fields data.rows` on `mb query`. Mutually exclusive with `--full`.
- `--max-bytes <n>` caps output (default 24576; `0` disables). A list over the cap drops trailing items and sets `truncated`; a single item over the cap exits 2 naming a narrower command to run. Follow it rather than raising the cap.

## List windows

Every list verb takes `--limit` and `--offset` and answers `{returned, offset, limit?, total, has_more, next_offset, truncated?, data}`.

- **`has_more` decides whether to continue; never compare counts.** `total` is `null` on endpoints that report none.
- **Pass `next_offset` back as `--offset`.** When `has_more` is false, `next_offset` is `null`.
- **`truncated` means the byte cap cut the output**, and `has_more`/`next_offset` are recomputed to the cut, so a capped list resumes like any window. Narrow rows with `--fields` rather than raising `--max-bytes`.

```bash
offset=0
while : ; do
  out=$(mb table list --db-id 1 --limit 50 --offset "$offset" --fields id,name --json)
  echo "$out" | jq -c '.data[]'
  [ "$(echo "$out" | jq -r '.has_more')" = "true" ] || break
  offset=$(echo "$out" | jq -r '.next_offset')
done
```

## Body input (`query`, `eid`, `transform-test create|update`)

The payload comes from one source, first non-empty wins: `--body '<json>'`, `--file <path>` (`--file -` for stdin), piped stdin, a positional argument. Passing more than one of `--body`, `--file` and a positional is a `ConfigError`.

```bash
mkdir -p ./.scratch
cat > ./.scratch/body.json <<'EOF'
{ ... }
EOF
mb query --file ./.scratch/body.json --json
```

Working files go in `./.scratch`, never `/tmp`; the app keeps it out of git. Content files go where the representation format puts them, never under `./.scratch`.

## Discovering commands and schemas

- `mb --help`, then `mb <group> --help`; `mb --help --json` lists every command.
- `mb <command> --help`: flags, enums, defaults, examples.
- `mb <command> --help --json`: `outputSchema` before parsing, `inputSchema` before authoring a body, and the server features the command needs.

## Resource quirks

What `--help` does not tell you.

- **db traversal: the hydration ladder.** Start with `db list` for the database ids, then `db get <db-id> --include tables`: the compact table map (id, name, schema, description per table), one call that fits most databases. Pick the tables the question needs, then `table fields <table-id>` or `table get <table-id> --include fields` per table; fields are bounded per table. `--include tables.fields` is the full rollup, for small databases only. Hundreds of tables: go by schema (`db schemas <db-id>`, then `db schema-tables <db-id> <schema>`) or look a table up by name (`search <term> --models table --db-id <db-id> --limit 10`). `sync-schema --wait` blocks until the sync completes; `rescan-values` queues and returns.
- **table and field.** `table get` returns fields only with `--include fields`. Fields have no `list`; never enumerate them across a whole database. `field summary` is live cardinality; `field values` is the cached distinct set (`has_more_values: true` means the cache is truncated). To write a filter, `table fields <table-id> --values` puts each dropdown field's raw values beside its name in one call; `null` means the field keeps no dropdown list.
- **ids.** A file names an entity by `entity_id`; a command takes the numeric id. `mb eid --model card <eid1,eid2> --json` translates. An entity id starting with `-` reads as a flag, so pass it as `--body '{"entity_ids":{"card":["-…"]}}'`.
- **card.** `card query <id> --export-format csv|xlsx` streams the raw export to stdout; pipe it to a file.
- **dashboard.** `dashboard get <id>` hydrates dashcards and tabs; `list` omits them. `dashboard parameter-values <id> <parameter-id> [--query <substr>]` shows what a filter widget offers.
- **archived lists swap.** `snippet list --archived` returns archived rows instead of active ones, never both; the same holds for `--filter archived` on dashboards and collections.
- **collection `<ref>`** is a positive int, `root`, `trash`, or a 21-character entity id. `collection tree` is JSON-only.
- **search vs. list.** Enumerate with `… list`; use `search --models <kind>` to rank against a query string or look across kinds.
<!-- requires: transforms -->
- **transform.** `transform run <id>` without `--wait` or `--sync` returns only `{run_id, final: null}`. `--sync` also waits for the output table to register and returns `target_table_id`.
  <!-- /requires -->
  <!-- requires: transformTests -->
- **transform-test.** `transform-test create --body '{"transform_id":…,"name":…,"inputs":[…],"expectations":[…]}'`, then `transform-test run <id>` answers `{status: "passed"|"failed", expectations: […]}`. The server checks inputs and expectations against the transform before saving; a refusal is an HTTP error whose code starts with `transform-test.`.
  <!-- /requires -->
  <!-- requires: library -->
- **library.** `library get` shows the Library and its Data and Metrics collections. `library publish --table-ids/--db-ids/--schemas` puts tables in Data (each `--schemas` entry is `<db-id>:<schema>`), creating the Library if absent; `publish` cascades to upstream FK targets, `unpublish` to downstream dependents. Both need admin or data-analyst rights and write and query permission on every affected table. `table get` carries `is_published`.
<!-- /requires -->

## The other skills

Load the one a step needs with `mb skills get <name>`; `mb skills list` shows those the connected server can use.

- **`rde`**: the data-engineering method, from raw tables through clean tables, definitions and dashboards to checked answers. Start here for any job bigger than one file.
- **`metabase-representation-format`**: the content file schemas and folder layout. Load before writing any content file.
- **`mbql`**: MBQL queries, in `mb query` and in files, and the dry-run loop.
- **`native-sql`**: native SQL with template tags, field filters, snippets and card references.
- **`visualization`**: a card's `display` and `visualization_settings`.
- **`dashboard`**: dashboard layout, filters, linked filters, cross-filtering, click behavior, tabs.
- **`metadata`**: table and field metadata files and what each setting unlocks.
<!-- requires: transforms -->
- **`transform`**: transform files, runs, tests, tags and jobs.
<!-- /requires -->
- **`document`**: document files, the ProseMirror body and embedded cards.
<!-- requires: remoteSync -->
- **`git-sync`**: putting a branch into Metabase and reading the sync state.
<!-- /requires -->

## Don't

- Don't write content any other way than as a file on the branch. Nothing else survives the next import.
- Don't `curl` `/api/...`; the `mb` verbs carry retries, schema validation and credential redaction.
- Don't hand-write an `entity_id` or a `lib/uuid`; mint them with `mb entity-id` and `mb uuid`.
