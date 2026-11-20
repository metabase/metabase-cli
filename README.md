# metabase-cli

Command-line client for Metabase. Logs in to an instance in your browser (OAuth, Metabase v62.3.3+) or with an API key, and stores credentials securely on your machine.

The command reference — every command's arguments, flags, examples and the Metabase features it needs — is generated from the command definitions into [`docs/commands`](docs/commands/README.md). This page covers what no one command owns.

## Supported Metabase versions

The CLI is built against Metabase majors **58 through 65** (the client's `KNOWN_RANGE`), the latest patch of each; a newer release runs as the major after the newest known one, with one stderr notice per run; a development build (master or a local build, reporting a tag such as `vUNKNOWN`) is treated as newer than every release, with every version-gated command available and no notice; and an older one keeps its real major and gets one stderr notice per run pointing at a Metabase upgrade; a command the server refuses for a feature it lacks names that feature and the version it needs.

Every command declares the client methods it calls, and each method names the server features it needs — a feature is a minimum major version, a premium token feature, or both. The reference names them on each command, as in "Needs `documentCopy` (v59+).", and says once at the top of a page what every command on it needs. The server decides whether a request is allowed: every command sends its requests, and when the server refuses one (an endpoint it does not serve, or a premium feature it does not grant), the CLI probes the server once and reports what is missing with an actionable message (exit code `2`):

- the server is older than the command's minimum version, or
- the command needs a premium feature (e.g. `remote_sync`, `content_translation`, `library`) that isn't enabled.

A license activated or a server upgraded after `mb auth login` takes effect on the next command; nothing has to be refreshed first. A request is refused before it is sent only where a server without the feature would answer wrongly without a word: a parameter it would drop or rewrite (`table list --unused-only` without the `dependencies` feature lists every table), or a call whose answer it would misread (git-sync's synced collections). The tracked branch is read from the same probe that judges it, and refused there before it is answered. The reference entries for `table list`, `table update`, `table bulk-edit`, `field update`, `field set-sensitivity`, `card query`, `query`, `data-action update`, `subscription create`, `search`, `git-sync status`, `git-sync import`, `git-sync export` and `git-sync export-preflight` name the parameters and calls refused this way. Such a refusal is judged against a probe taken in the same run, never the cached one, so the command costs at most one request more than it would otherwise, even when the cache grants the feature: a cache can be wrong in that direction too, after a license lapses.

These refusals are the CLI's own judgement, read from its table of which release and which premium feature brings each feature, so a feature backported to an older release, or a rule the table gets wrong, is refused although the server would serve it. `--skip-preflight`, taken by every command that takes `--url` and `--api-key` (all but `auth list`, `auth status`, `auth logout`, `skills`, `uuid` and `upgrade`, none of which makes these checks), or `MB_CLI_SKIP_PREFLIGHT=1` in the environment, skips them, sends the request anyway and lets the server answer; a refusal of a feature the server lacks names the flag. Each check it lets through prints one stderr warning naming what was skipped, because a server that truly lacks the feature may ignore or rewrite what it does not support and answer without saying so; when the server cannot be checked at all, the request goes out unchecked with one warning per run. It skips nothing else: input the CLI rejects, a refusal read from the server's own settings (pivoted exports turned off, an unset or unreadable tracked branch), and a refusal the server answers itself stand as they are.

`mb auth status --json` reports the window as `knownRange` and where the server sits as `skew`. A release above the window is read as the major after the newest known one: its additions pass through, and one stderr notice per run points at `mb upgrade`. A development build is `development`, ahead of every release, and prints no notice; a server below the window is `older-than-known`, still evaluated at its own major, with a notice naming the oldest major the CLI supports. A response the CLI cannot parse under a cached profile triggers one fresh probe: if the server's version or premium features changed since the cache was written, the profile is refreshed and the error says so — retry the command.

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

File paths in this document are relative to the repository root, so they resolve in a checkout of <https://github.com/metabase/metabase-cli> rather than in the installed package — the npm tarball carries only `dist`, `skills` and `skill-data`.

## Quick start

```sh
mb auth login --url https://metabase.example.com
mb auth status
```

[`mb auth`](docs/commands/auth.md) describes the login methods, profiles, and the server probe.

## Output

Most commands take the output flags, and every list command the window flags `--limit` and `--offset`; the reference documents each set once, under [Shared flags](docs/commands/README.md#shared-flags). `--format auto`, the default, prints JSON when stdout is not a terminal, so a shell capture that wants plain text passes `--format text`. A `get` or `list` prints a compact projection of each item: `--full` prints every field, and `--fields` projects comma-separated dot-paths, relative to each `data[]` item on a list. `--max-bytes` caps the output (default `24576`, `0` disables).

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

## Input

A command that takes a JSON body reads it from exactly one of `--body <json>`, `--file <path>` (`--file -` reads stdin), or piped stdin; two explicit sources are refused. `mb schema <command>` prints the body a command accepts. A body that is not JSON exits `2`, and one that does not match the command's schema exits `1`.

A command that deletes asks for confirmation on a terminal. Without a terminal it refuses with exit `2` unless `--yes` is given, so a script never destroys what it never saw a prompt for.

## Agent skills

The CLI ships agent skills that document `mb` itself, served by [`mb skills`](docs/commands/skills.md) from the installed version. Two discovery surfaces point an agent at them:

- **Claude Code plugin marketplace**: `.claude-plugin/marketplace.json` declares a `metabase-cli` plugin pointing at the in-repo discovery stub. Users install with `/plugin marketplace add metabase/metabase-cli` then `/plugin install metabase-cli@metabase`. The manifest lives at the repo root and is served from GitHub, not from the npm tarball: its `source: "./packages/cli"` is resolved relative to the repo checkout, so a copy inside the published package would point at nothing. `files` in `packages/cli/package.json` therefore omits `.claude-plugin` by design.
- **`npx skills add`**: the same stub at `packages/cli/skills/metabase-cli/SKILL.md` is picked up by `npx skills add metabase/metabase-cli`. The stub is intentionally minimal — it redirects the agent at `mb skills get core` so the real workflow content always comes from the installed CLI version.

## Environment variables

| Variable                 | Effect                                                                                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MB_URL`                 | Default URL for `auth login` and config resolution.                                                                                                                          |
| `MB_API_KEY`             | Default API key (makes `auth login` non-interactive, skipping the browser flow; not stored).                                                                                 |
| `MB_PROFILE`             | Default profile when `--profile` is omitted. Falls back to `default`.                                                                                                        |
| `MB_VERBOSE`             | When set to `1`, prints structured developer-detail JSON to stderr on failure.                                                                                               |
| `MB_CLI_SKIP_PREFLIGHT`  | When set to `1`, every command acts as if `--skip-preflight` were passed, unless `--no-skip-preflight` is (see [Supported Metabase versions](#supported-metabase-versions)). |
| `MB_CLI_DISABLE_KEYRING` | When set to `1`, skips the OS keychain and stores credentials as plaintext in the profiles file.                                                                             |
| `MB_SKILLS_DIR`          | Override the directory `mb skills` scans (dev/test only; defaults to the CLI's bundled `skills` + `skill-data` trees).                                                       |

The former `METABASE_`-prefixed names (`METABASE_URL`, `METABASE_API_KEY`, `METABASE_PROFILE`, `METABASE_VERBOSE`, `METABASE_CLI_SKIP_PREFLIGHT`, `METABASE_CLI_DISABLE_KEYRING`) are deprecated but still honored; the CLI prints a one-line warning to stderr when it falls back to one. Switch to the `MB_`-prefixed names.

## Agent integration

### `--help --json`

Every node of the command tree answers `--help --json` with machine-readable help, mirroring what text help shows at that level:

- A leaf command emits its full entry — name, description, `details`, examples, citty args with types/defaults/enums, and `requires` (the client methods the command calls and the server features they need). The body schema is `mb schema <command>`, the output schema `mb schema <command> --output`.
- A command group (and the root) emits `{ description, skills, commands }` — its own sentence (`null` when it declares none), its own agent-skill pointers, and a flat `commands: [{ command, description }]` index of every leaf in its subtree, with full-path names.

```sh
mb --help --json | jq -r '.commands[].command'    # every command
mb card create --help --json | jq .args          # one command's flags
mb schema card create                             # the JSON body it validates
```

The entry and index schemas (`CommandHelpEntry`, `CommandHelpIndex`) are exported from `packages/cli/src/runtime/command-help.ts`.

## Exit codes

| Code  | Meaning                                                                                         |
| ----- | ----------------------------------------------------------------------------------------------- |
| `0`   | Success.                                                                                        |
| `1`   | Verification or operation failed, or the server applied a write only in part (`partial-write`). |
| `2`   | Configuration error (invalid flag, missing TTY, etc.).                                          |
| `130` | Interactive prompt cancelled (Ctrl+C).                                                          |

## Working in the repo

```sh
bun install
bun run check          # the full gate: typecheck, lint, format, unit tests, skill lint
bun run build
bun run test           # unit tests
bun run typecheck
bun run lint
bun run docs           # regenerate docs/commands from the command definitions and docs/command-notes
```

A command's reference page is written from its definition — `description`, `details`, argument
descriptions, `examples`, `requires` — and from `docs/command-notes/<command>.md` when there is
one. Change those, never `docs/commands/`, and run `bun run docs`.

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
