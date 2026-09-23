# metabase-cli

Command-line client for building Metabase content as YAML files. It reads warehouse metadata from a Metabase instance, validates [representation format](https://github.com/metabase/representations) files, and saves a git repository into Metabase. It logs in to an instance in your browser (OAuth, Metabase v63+) or with an API key, and stores credentials securely on your machine.
## Supported Metabase versions

The CLI is built against Metabase majors **58 through 64** (the client's `KNOWN_RANGE`), the latest patch of each; a newer server, or a head build whose version tag does not parse, runs as a head build past the newest known major: it gets every shape the client knows head answers with, and one stderr notice per run: and an older one keeps its real major, gets one stderr notice per run pointing at a Metabase upgrade, and is refused command by command with the version it needs.

Every command declares the client methods it calls, and each method names the server features it needs: a feature is a minimum major version, a premium token feature, or both. The server version and token features are detected and cached when you run `mb auth login` (or `mb auth list`). For a command whose methods need a feature, a preflight check runs before the first request and refuses with an actionable message (exit code `2`) when:

- the server is older than the command's minimum version, or
- the command needs a premium feature (`remote_sync`, which `mb save` needs) that isn't enabled.

Plain OSS commands against a v0.58+ server (the majority) carry no elevated requirement and skip the preflight entirely. When a gated command runs without a cached probe, the CLI asks the server for its version once and decides on the answer; a server that cannot be reached fails the command with that network error. To bypass the check for a single run, pass `--skip-preflight`; to bypass it process-wide (e.g. in CI), set `MB_CLI_SKIP_PREFLIGHT=1`. Both switch off the client's own check too, so every request goes to the wire and the server answers for itself: footguns, only for servers you know are patched.

`mb auth status --json` reports the window as `knownRange` and where the server sits as `skew`. A server above the window is read as a head build past the newest known major; its additions pass through, and one stderr notice per run points at `mb upgrade`; a server whose version tag does not parse (head builds) is treated the same way with its own notice; a server below the window is `older-than-known`, still evaluated at its own major, with a notice naming the oldest major the CLI supports. A response the CLI cannot parse, or a refusal it issues, under a cached profile triggers one fresh probe: if the server's version or premium features changed since the cache was written, the profile is refreshed and the error says so: retry the command.

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

File paths in this document are relative to the repository root, so they resolve in a checkout of <https://github.com/metabase/mb-cli> rather than in the installed package: the npm tarball carries only `dist`, `skills` and `skill-data`.

## Quick start

```sh
mb auth login --url https://metabase.example.com
mb metadata
mb check ./my-repo
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
| `has_more`    | Whether more items remain. This field, not `returned` against `total`, says to keep going.          |
| `next_offset` | Pass back as `--offset` for the next window; `null` when the walk is over.                              |
| `truncated`   | Present when `--max-bytes` dropped trailing items; `bytes` is what the full answer would have measured. |

When the cap leaves no room for even one item, the list comes back empty with `next_offset: null`: narrow it with `--fields` or raise the cap. A `get` whose single item is over the cap fails instead, with exit `2`.

## Authentication

Credentials are stored per-profile. The default profile is named `default`. Use `--profile <name>` to manage additional profiles.

### `mb auth login`

Log in to a Metabase instance and save the credential to a profile. Interactive login offers two methods:

- **In your browser** (recommended; requires Metabase v63 or newer): the CLI opens Metabase, you sign in with your password or SSO and approve the CLI, and a short-lived access token plus a rotating refresh token are stored. Tokens refresh automatically; you never paste a secret.
- **With an API key**: paste a key from Admin settings → Authentication → API keys.

Against a server older than v63 the CLI detects the missing OAuth support and falls back to the API key prompt automatically. Supplying an API key (flag, env, or stdin) always skips the browser flow, so CI and scripts behave exactly as before.

On success the server is probed once: the rendered output shows the user, role (`Admin`/`User`), Metabase version and skew (`--json` adds `edition`, `knownRange` and `features`), and the probe is cached in `<configDir>/profiles.json` so later commands skip re-probing. Failure of either the auth probe (`/api/user/current`) or the server probe (`/api/session/properties`) rejects the login; an existing profile keeps its last-known-good credential and gains a `lastFailure` entry.

| Flag                     | Description                                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `--url <url>`            | Metabase URL, including any subpath if the instance is hosted under one (`https://my.org.com/metabase`). Falls back to `MB_URL`, then prompts. |
| `--api-key <value>`      | API key. Skips the browser flow. Visible in shell history: pipe on stdin instead.                                                             |
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

`auth list` re-probes every profile, one at a time: a probe can refresh and rewrite an expired OAuth token, so probes are serialized to avoid racing on the shared `profiles.json`. On success it refreshes `lastProbe` (Metabase version, token features, user identity) and clears `lastFailure`; on failure it updates `lastFailure` and leaves the prior `lastProbe`/`url`/credential untouched. Rendered columns: `Profile | URL | Auth | Status | Role | Version | Skew | Last probed`; `--json` rows carry the same derived `edition`, `skew`, `knownRange` and `features` as `auth status`. Failed rows append a one-line footer pointing at `mb auth login --profile <name>`.

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


## File mode: metadata, edit, check, save

The CLI builds Metabase content from YAML files in a git repository: the [Metabase representation format](https://github.com/metabase/representations). An agent or a human edits the files, and Metabase imports the repository through git-sync (remote sync). The CLI has three working commands:

| Command       | Does                                                                     | Talks to Metabase |
| ------------- | ------------------------------------------------------------------------ | ----------------- |
| `mb metadata` | Reads databases, tables, and fields, each with its natural-key `ref`     | Yes               |
| `mb check`    | Validates the repository's YAML against the representation schemas     | No                |
| `mb save`     | Runs `check`, commits, pushes, and imports the repository into Metabase | Yes               |

Content has no create, update, or delete commands. The files are the only write path.

### `mb metadata [database-id] [table-id]`

Read warehouse metadata one level per call:

```sh
mb metadata              # databases: id, name, engine
mb metadata 1            # tables of database 1: id, schema, name, display_name, ref
mb metadata 1 42 --json  # fields of table 42
```

Each table row carries `ref: [database, schema, table]`. Each field row carries:

| Field              | Meaning                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `ref`              | `[database, schema, table, field]`, the natural key a YAML file writes                   |
| `base_type`        | The warehouse type as Metabase maps it (`type/Integer`, `type/Text`, ...)                |
| `semantic_type`    | The field's meaning (`type/PK`, `type/FK`, `type/Category`, ...), or `null`              |
| `fk_target`        | The `ref` of the field a foreign key points at, or `null`                                |
| `has_field_values` | `list`, `auto-list`, `search`, `none`, or `null`                                         |
| `values`           | The distinct values of a `list` or `auto-list` field, or `null` for every other field    |

The database and table ids only select the level to read. YAML files never contain them. A field request makes one `GET /api/database/:id?include=tables.fields` call, plus one `GET /api/field/:id/values` call per dropdown field.

### `mb check [folder]`

Validate every importable YAML file in the folder (default: the current directory) against the JSON schemas bundled in [`@metabase/representations`](https://www.npmjs.com/package/@metabase/representations). The command runs offline.

```sh
mb check
mb check ./my-repo --json
```

The output lists only failing files, as `{file, model, errors: [{path, message}]}` rows, beside `passed` and `failed` counts. The exit code is `1` when any file fails.

### `mb save -m <message> [folder]`

Save the repository to Metabase. The steps run in this order, and the first failure stops the command:

1. Run `mb check`. Any failure stops the save.
2. Compare the current git branch with the `remote-sync-branch` setting. A mismatch stops the save.
3. `git add -A`, then `git commit -m <message>`. The commit is skipped when nothing is staged.
4. `git push origin <branch>`.
5. Start a git-sync import and poll it until it finishes. An `errored`, `timed-out`, or `conflict` result exits `1`.

```sh
mb save -m "add weekly revenue dashboard"
mb save ./my-repo -m "fix filter" --json
```

| Flag                    | Description                                                     |
| ----------------------- | --------------------------------------------------------------- |
| `--message <msg>`, `-m` | Required. The commit message.                                   |
| `--wait` / `--no-wait`  | Poll the import until it finishes (default: wait).              |
| `--timeout <ms>`        | Polling timeout in ms (default 600000).                         |
| `--interval <ms>`       | Polling interval in ms (default 2000).                          |

`save` needs Metabase v60 or newer, the `remote_sync` premium feature, and superuser credentials.

## Skills

The CLI ships agent skills (Claude Code and `npx skills add` compatible) that document `mb` itself. The installed CLI serves them at runtime, so an agent always reads the guide for the binary it runs.

```sh
mb skills list                              # bundled skills
mb skills get core                          # the metadata -> edit -> check -> save loop
mb skills get representations,dashboard     # several skills at once
mb skills get core --full                   # include references and templates
mb skills get --all --json --max-bytes 0    # every non-hidden skill (the default cap truncates)
mb skills path representations              # the skill's directory, for direct reads
```

The `representations` skill directory holds the full format spec and the JSON schemas, copied from `@metabase/representations` by `bun run sync:representations`. An agent reads `spec/spec.md` and `spec/schemas/<entity>.yaml` from the path that `mb skills path representations` prints.

A skill can declare server features in its frontmatter (`requires: [<feature>, ...]`) or around a passage (`<!-- requires: <feature> -->` ... `<!-- /requires -->`). `skills list` and `skills get` resolve these against the profile's cached server probe and leave out what the server cannot use. `--unfiltered` prints skills as written.

Bundled skills:

| Name              | Use                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------- |
| `core`            | The loop: `mb metadata`, edit YAML, `mb check`, `mb save`; auth; output conventions    |
| `representations` | The format: spec and schema locations, folder layout, entity_ids, natural-key refs    |
| `mbql`            | MBQL queries in YAML (card `dataset_query`, transform source, segment/measure)        |
| `native-sql`      | Native SQL queries in YAML: template tags, field filters, snippets                    |
| `visualization`   | A card's `display` and `visualization_settings`                                       |
| `dashboard`       | Dashboard YAML: grid layout, dashcards, filters, click behavior, tabs                 |
| `transform`       | Transform, transform tag, and transform job YAML                                      |
| `document`        | Document YAML and the cards embedded in it                                            |
| `notification`    | Notification channel YAML                                                             |

Discovery surfaces:

- **Claude Code plugin marketplace**: `.claude-plugin/marketplace.json` declares a `metabase-cli` plugin pointing at the in-repo discovery stub. Users install with `/plugin marketplace add metabase/mb-cli` then `/plugin install metabase-cli@metabase`. The manifest lives at the repo root and is served from GitHub, not from the npm tarball: its `source: "./packages/cli"` is resolved relative to the repo checkout, so a copy inside the published package would point at nothing. `files` in `packages/cli/package.json` therefore omits `.claude-plugin` by design.
- **`npx skills add`**: the same stub at `packages/cli/skills/metabase-cli/SKILL.md` is picked up by `npx skills add metabase/mb-cli`. The stub is intentionally minimal: it redirects the agent at `mb skills get core` so the real workflow content always comes from the installed CLI version.

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

- A leaf command emits its full entry: name, description, `details`, examples, citty args with types/defaults/enums, `requires` (the client methods the command calls and the server features they need), and the output Zod schema rendered as JSON Schema.
- A command group (and the root) emits `{ description, skills, commands }`: its own sentence (`null` when it declares none), its own agent-skill pointers, and a flat `commands: [{ command, description }]` index of every leaf in its subtree, with full-path names.

```sh
mb --help --json | jq -r '.commands[].command'    # every command
mb metadata --help --json | jq .outputSchema      # one command's output schema
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
