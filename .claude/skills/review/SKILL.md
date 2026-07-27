---
name: review
description: Strict end-of-task review. Use before marking any non-trivial task done. Returns axis-by-axis pass/fail; any FAIL blocks completion. Trigger on user /review or end-of-task self-check.
---

# review

Non-deterministic architectural check that complements the deterministic gate (`bun run check` — typecheck, lint, format, unit tests, skill lint). Determinism catches typos; this catches drift.

## When to invoke

- After finishing any non-trivial change, before claiming "done."
- On user `/review`.

## Inputs

1. Diff scope:
   - `git diff` (uncommitted) AND
   - `git diff main...HEAD` if on a feature branch.
   - If outside a git repo, review uncommitted changes only.
2. `CLAUDE.md`.

Read both before forming any judgment. All other rules required for this review are embedded in this skill below — do not depend on any external doc.

## Project layering (memorize)

A bun workspace with two packages. `packages/client` (`@metabase/client`) is the private Metabase API client, built by `tsdown` to a `dist/` its `exports` map names; `packages/cli` (`@metabase/cli`) is the publishable CLI built on it, and inlines the client at build time. The e2e tier lives at the repo root under `tests/e2e/` and drives the built binary; unit tests sit beside their source under `packages/<p>/src/**/*.test.ts`.

```
packages/client/src/
  index.ts                  public barrel: client factory, error taxonomy, Credential, parseJson
  client.ts                 createClient — composes the resource namespaces onto one transport
  resources/                one file per Metabase resource; every /api/ path and transport call
  http/                     the HTTP boundary — transport.ts, errors.ts, network-error.ts,
                            response-shape.ts, sanitize.ts, retry.ts, oauth.ts
  testing/                  the shipped test doubles — fake-client.ts, fetch-capture.ts
  auth/                     OAuth login flow: credential.ts, pkce.ts, callback-server.ts, oauth-*.ts
  version/                  tag.ts, probe.ts, capabilities.ts, preflight-error.ts
  domain/                   Metabase API resource Zod schemas + inferred types
  errors.ts                 MetabaseError taxonomy, toMetabaseError, isFileNotFoundError, errorMessage
  list.ts                   ListResult<T> = { data, total } — what a one-response list method returns
  url.ts                    normalizeUrl, displayUrl, assertEndpointOrigin — the only home for new URL()
  json.ts                   parseJson — the only home for JSON.parse
  poll.ts                   pollUntil — the wait-loop home (http/retry.ts drives its own backoff wait)
  paginate.ts, signal.ts, predicates.ts, json-pointer.ts

packages/cli/src/
  cli.ts                    entrypoint; only file allowed to call process.exit
  main.ts                   root citty command, lazy subCommands
  commands/                 CLI shell — defineMetabaseCommand, flags, prompts, orchestration
  core/                     pure logic, no CLI deps
    core/auth/              credential storage + verification
    core/config.ts          flag → env → stored resolver
    core/env.ts             readEnv — every MB_* env name, no raw process.env reads elsewhere
    core/user-agent.ts      USER_AGENT, the CLI's wire identity
    core/npm-registry.ts    the upgrade check's dist-tags lookup — the CLI's only fetch()
    core/system-ca.ts       trustSystemCa — the only node:tls in the repo, a CLI prerogative
  output/                   presentation; takes typed values; renders text or JSON
  runtime/                  platform glue: stdin, csv, yaml, citty helpers
```

Allowed import direction — the package boundary first, then within each package:

- **Nothing in the client may import from the CLI** — not by an `@metabase/cli` specifier, not by a relative path that escapes the client's own src tree. The reverse is expected: the CLI consumes the client as `@metabase/client/<path>`.
- The client's dependency budget is `zod` + `semver` + `node:` builtins. Root devDependencies hoist, so the resolver will not reject a third dependency — a production client file importing anything else is FAIL even though it type-checks.
- `domain/*` imports only `zod` and sibling `domain/*` files. Nothing from elsewhere in either package.
- `resources/*` is imported by `client.ts` and by sibling `resources/*` files, and by nothing else. A `domain/`, `http/`, `auth/` or `version/` file importing a resource is FAIL — the direction runs one way, and the permitted importers are an allowlist, so a directory added later is not exempt for having arrived after the rule.
- `commands/*` may import `core/*`, `output/*`, `runtime/*`, and any `@metabase/client/*` path.
- `core/*` may import `runtime/*` and `@metabase/client/*`. Never `commands/`, never `output/`.
- `output/*` may import `runtime/*`, `core/*` except `core/auth/`, and `@metabase/client/*` **except `@metabase/client/http/`** — presentation consumes the error taxonomy from `@metabase/client/errors`, not the HTTP boundary. Never `commands/`.
- `runtime/*` may import `@metabase/client/*` (typed errors are the project's pattern: `runtime/body.ts` uses `parseJson` and `ConfigError`, `runtime/yaml.ts` uses `ValidationError`). It must not import from `commands/`, `core/`, or `output/`.

## Domain-file contract

Every Metabase API resource in `packages/client/src/domain/<resource-singular>.ts` exports exactly two things per resource — the client's agent-facing contract:

1. **`<Resource>`** — `z.object({ ... }).loose()` for the full API shape, with the type inferred via `z.infer`. `.loose()` is the default so Metabase API additions don't break the parse — tighten over time, don't preempt. (Zod 4 — `.passthrough()` is deprecated; use `.loose()`.)
2. **`<Resource>Compact`** — `<Resource>.pick({ ... }).strip()` projection with its inferred type. The trailing `.strip()` is **mandatory**: `.pick()` on a `.loose()` parent inherits the loose catchall and silently passes every API field through at parse time, which means the "compact" projection isn't actually compact. A diff that lands a Compact missing `.strip()` is FAIL — quote `<Resource>.pick({...})` without trailing `.strip()`.

Presentation is CLI-owned, never the client's: the `<resource>View` (`ResourceView<T>` with `compactPick: <Resource>Compact` and `tableColumns: ColumnDef<T>[]`) lives in `packages/cli/src/output/views/<r>.ts`, with any `format:` cell helper colocated there. A `ResourceView`, a `ColumnDef`, a `tableColumns` list, or a terminal-presentation `format:` helper appearing in `packages/client/src/domain/` is FAIL. Inlining a column list inside a command is FAIL.

Naming: `<Resource>` is PascalCase (`Card`); the CLI-side `<resource>View` is camelCase (`cardView`). `<Resource>` is the _resource name_, not the file name — a file may host multiple resources (e.g. `domain/user.ts` → `CurrentUser` + `CurrentUserCompact`); the pair contract holds per-resource.

Adding a resource is additive: a new `packages/client/src/domain/<r>.ts` for the pair, `packages/client/src/resources/<r>.ts` for the methods, and `packages/cli/src/output/views/<r>.ts` for the view — consumed by commands as `client.<r>.<method>(…)`, `@metabase/client/domain/<r>` and `../../output/views/<r>`. A schema declared in `packages/cli` instead — or a command importing one by a relative path into the client's src tree — is FAIL. Editing existing commands to wire the schema is FAIL — commands import what they need. Do **not** require a fixture + parse-test pair — that is a tautology against Zod itself. The schema is contract-tested by the e2e tier when a command consuming it runs against the live API.

A new or modified API resource without both exports, or that omits `.loose()` on the full schema, or that omits `.strip()` after `.pick()` on the Compact, or that hand-rolls `Array<Record<string, unknown>>` / inline `as { ... }` casts in commands instead of consuming `z.infer<typeof Schema>`, is a structural failure.

`Record<string, unknown>` is forbidden in command files. The single exemption is `packages/cli/src/output/projection.ts` — the canonical structurally-untyped envelope for dot-path `--fields` projection over already-validated payloads.

## Resource-method contract

`packages/client/src/resources/<r>.ts` exports `<r>Resource(transport)` and holds every `/api/` path the client sends. `packages/client/src/client.ts` composes each namespace onto the client, so a resource file with no line in `client.ts` is unreachable and FAIL. Eight conventions bind every method:

1. `client.<resource>.<method>(...)`, namespace named after the API resource (`mb.card`, singular). The resource is what Metabase calls the thing, not what it calls the route: the file and the namespace are `snippet` even though the endpoint is `/api/native-query-snippet`, because the domain schema, the CLI noun and the Metabase concept all read `snippet`.
2. Path parameters positional, then params, then options: `update(id, params, options?)`.
3. Params use Metabase's own field names verbatim — `f`, `model_id`, `include_inactive`. **No mapping layer, no renaming.**
4. Transport concerns (`signal`, `timeoutMs`, `retries`) live in the trailing `options`, never in params.
5. Wire envelope schemas are module-private to `resources/`; they never appear in `domain/`.
6. Methods return domain values, never wire envelopes. Non-paginated lists return `ListResult<T>` = `{ data, total }`.
7. A string path parameter always goes through `encodeURIComponent`.
8. Every method carries the endpoint's description as a doc comment.

A method violating any of the eight is FAIL — quote the signature or the path template. Convention 7 is the one with a silent failure mode: an un-escaped string interpolated into a path template lets a `/` or `?` in a setting key or collection ref rewrite the request.

A new or changed method comes with its wire test in `packages/client/src/resources/<r>.test.ts` — one `it` per method, asserting URL, verb, headers and body in a single `toEqual` over `capture.calls` from `@metabase/client/testing/fetch-capture`. That test is what pins the path and query vocabulary; a method landed without one is FAIL.

## Forbidden patterns and their permitted homes

CLAUDE.md declares these as a **separate policy per package**, applied to production source only (`*.test.ts` files are exempt). A pattern's permitted home in one package says nothing about the other: `JSON.parse` has a home in the client and none in the CLI, `fetch` has a home in each but at different paths. The e2e-side restrictions below are part of this review too.

### The client — every file under `packages/client/src/`

| Pattern                                                                                        | Permitted only in                       |
| ---------------------------------------------------------------------------------------------- | --------------------------------------- |
| bare `fetch(`, `globalThis.fetch`, third-party HTTP libs (`got`/`axios`/`node-fetch`/`undici`) | `http/**`                               |
| `new URL(`                                                                                     | `http/**`, `url.ts`                     |
| `JSON.parse(`                                                                                  | `json.ts`                               |
| `setTimeout` inside an `await` wait loop                                                       | `poll.ts`, `http/retry.ts`              |
| `process.stdout.write`, `process.stderr.write`                                                 | nowhere — the client owns no output     |
| `process.exit(`                                                                                | nowhere — the client never ends the run |
| `@clack/prompts`, `@clack/core`                                                                | nowhere — prompting is the CLI's job    |
| `fs`, `fs/promises`, `node:fs`, `node:fs/promises`                                             | nowhere — the client touches no files   |
| `child_process`, `node:child_process`                                                          | nowhere — the client spawns nothing     |
| a `.ts` extension in an import specifier                                                       | nowhere                                 |
| any dependency beyond `zod`, `semver`, `node:` builtins                                        | nowhere                                 |
| an import resolving into `packages/cli`                                                        | nowhere                                 |

### The CLI — every file under `packages/cli/src/`

| Pattern                                                                | Permitted only in                                                                                                                                              |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `process.exit(`                                                        | `cli.ts`                                                                                                                                                       |
| `process.stderr.write`                                                 | `cli.ts`, `output/**`                                                                                                                                          |
| `process.stdout.write`                                                 | `output/**`                                                                                                                                                    |
| `JSON.parse(`                                                          | nowhere — use `parseJson` from `@metabase/client/json`                                                                                                         |
| `new URL(`                                                             | nowhere — use the helpers in `@metabase/client/url`                                                                                                            |
| bare `fetch(`, `globalThis.fetch`, third-party HTTP libs               | `core/npm-registry.ts` (not a Metabase endpoint)                                                                                                               |
| `setTimeout` inside an `await` wait loop                               | nowhere — use `pollUntil` from `@metabase/client/poll`                                                                                                         |
| `child_process` (`spawn`, `exec`, etc.)                                | `runtime/process.ts`                                                                                                                                           |
| `@clack/prompts`, `@clack/core`                                        | `output/prompt.ts`                                                                                                                                             |
| `Record<string, unknown>`                                              | nowhere under `commands/` — the walker scopes this rule to command files; `output/projection.ts` is the canonical untyped envelope and sits outside that scope |
| an import of `@metabase/client/http/**` from `output/**`               | nowhere — presentation uses `@metabase/client/errors`                                                                                                          |
| a `.ts` extension in an import specifier                               | nowhere                                                                                                                                                        |
| `process.env["MB_*"]`, `process.env["METABASE_*"]`                     | `core/env.ts` — CLI env vars go through `readEnv`. A CLAUDE.md rule, not walker-enforced; judge it by reading, not by trusting the gate                        |
| an `/api/…` path literal (`"/api/` or `` `/api/ ``)                    | nowhere under `commands/` — endpoints are the client's `resources/` layer                                                                                      |
| `.requestParsed(`, `.requestRaw(`, `.requestStream(`, `paginatePages(` | nowhere under `commands/` — a command calls `client.<resource>.<method>(…)`                                                                                    |

The last two are **absolute**: neither has a sanctioned home anywhere in the CLI. A diff that lands a command naming a path or driving the transport is FAIL.

What those two patterns bound is a path literal and a transport call, not every client function that can open a socket. `commands/auth/login.ts` calls `tryDiscoverMetadata` from `@metabase/client/http/oauth`, which fetches the OAuth discovery document before any credential exists and therefore before a client can be constructed; that one is sanctioned. A **second** such call from `commands/` is FAIL — the pattern rules cannot see it, so review is the only thing that can.

Two rules bind both packages but come from elsewhere, so judge them repo-wide rather than per-package:

- `console.{log,warn,error,info,debug}` — forbidden everywhere, including `output/**` and `tests/`. `.oxlintrc.json` sets `no-console: error` with no overrides; write through `output/render.ts` instead.
- Platform env vars (`XDG_CONFIG_HOME`, `APPDATA`, `npm_config_prefix`) are read where they are used — `core/paths.ts`, `core/install-method.ts`, `core/auth/temp-config-home.ts`. `readEnv` owns the `MB_`/`METABASE_` family only; do not flag the others.

### The test tree — every file under the repo-root `tests/`, outside the walker but still reviewed here

| Pattern                                                     | Permitted only in                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `process.exit(`, `process.std*.write`                       | `tests/e2e/setup/**`                                                            |
| `/api/testing/snapshot`, `/api/testing/restore`             | `tests/e2e/setup/**` — a `beforeEach` there restores before every test          |
| `fetch(` against Metabase                                   | `tests/e2e/setup/**` (bootstrap, oauth harness)                                 |
| `child_process` / `execa`                                   | `tests/e2e/run-cli.ts`, `tests/e2e/setup/**`, `scripts/**`                      |
| Hand-written ENOENT shape check (`error.code === "ENOENT"`) | nowhere — use `isFileNotFoundError` from `@metabase/client/errors`              |
| Inline `JSON.parse(...) ; Schema.parse(...)`                | nowhere — use `parseJson(raw, Schema, { source })` from `@metabase/client/json` |

## Type strictness rules (always)

- No `as` cast in any form: `as X`, `as unknown as`, `as never`, `as any`. Use type guards or Zod `.parse`.
- No `any` in declared types.
- No `Record<string, unknown>` used as a typed value (it is allowed only inside the structurally-untyped output envelope).
- No `!` non-null assertions.
- No `// @ts-ignore`, `// @ts-nocheck`, `// @ts-expect-error` (paired comment with `// reason:` and `// FIXME(date)` only).
- Every cross-network value passes through Zod `.parse` before downstream code touches it.
- Imports are extensionless. Type-only imports use `import type`.

## Test-parity rules

- New `packages/cli/src/commands/<noun>/<verb>.ts` ⇒ a `tests/e2e/<noun>.e2e.test.ts` exists and exercises that subcommand end-to-end via `runCli`. Adding a new command without an e2e test is FAIL.
- New `packages/cli/src/commands/<noun>/<verb>.ts` (any leaf) ⇒ `packages/cli/src/runtime/command-help.test.ts`'s literal `ALL_COMMANDS` list includes the new path. Renaming or deleting a command without updating the list is FAIL.
- New or changed method in `packages/client/src/resources/<r>.ts` ⇒ `packages/client/src/resources/<r>.test.ts` covers it with a wire assertion over `capture.calls` (URL, verb, headers, body) built on `captureFetch` from `@metabase/client/testing/fetch-capture`. A method with no wire test is FAIL — nothing else pins the path or the query vocabulary at the unit tier.
- New `packages/client/src/domain/<r>.ts` ⇒ no fixture-and-parse-test pair required. A unit test of the form `Schema.parse(fixture).toEqual(fixture)` is a tautology against Zod and is FAIL if introduced. The schema's contract is tested by the e2e tier hitting the live API.
- New pure helper anywhere in `packages/client/src/` or in the CLI's `core/`, `output/`, `runtime/` ⇒ a colocated unit test (`<name>.test.ts` beside `<name>.ts`, inside the same package) imports from it.
- New helper with infinite input space (URL parsing, JSON parsing, projection, byte cap, polling) ⇒ a property test (`fast-check`).

## E2E test contract

- E2E tests drive the built `packages/cli/dist/cli.mjs` through `runCli` from `tests/e2e/run-cli.ts`. Direct `execa`, `spawn`, or `child_process` calls inside `tests/e2e/**/*.e2e.test.ts` are FAIL.
- E2E tests read admin credentials via `readBootstrap()` from `tests/e2e/bootstrap-data.ts` and seeded entity ids via `SEEDED` from `tests/e2e/seed/seeded.ts`. Inline `fetch` to Metabase, hard-coded API keys, hard-coded entity ids, or calls to `/api/setup` from a test are FAIL.
- The `Bootstrap` Zod schema and `BOOTSTRAP_FILE_PATH` constant live only in `tests/e2e/bootstrap-data.ts`. Re-declaring either in `tests/e2e/setup/bootstrap.ts` (or anywhere else) is FAIL — the writer imports from the reader to prevent shape drift.
- `--json` output assertions parse through the schema imported from the package that owns it: `@metabase/client/domain/<r>` for a resource, `../../packages/cli/src/commands/<noun>/<verb>` for a command-shaped output (e.g. `LoginResult`, `AuthStatus`, `<Resource>ListEnvelope`). Re-declaring a `z.object({...})` in a test that mirrors either export is FAIL.
- Each test or test-group gets its own `XDG_CONFIG_HOME` via `mkTempConfigHome()`. Sharing config home across tests that mutate credentials is FAIL.
- A suite whose command declares non-baseline `capabilities` gates itself with `requireServer("<lane>", {...})` from `tests/e2e/server-gate.ts`, passing a lane label naming the describe or test the gate guards so an unmet gate is reported in the closing coverage block. A suite that fails instead of skipping on a server that cannot satisfy the command is FAIL.

## Axes (output one row per axis)

For each axis below, output `PASS`, `FAIL`, or `UNKNOWN`. For every `FAIL` and `UNKNOWN`, quote the offending snippet with `path:line` and a one-sentence explanation.

1. **Layering** — direction rules above, judged against the package the file is in.
2. **Type strictness** — rules above.
3. **Output discipline** — `console.*`, `process.exit`, `process.std*.write` outside permitted homes. A file under `packages/client/src/` writing to a stream or ending the process is FAIL regardless of path — the client has no permitted home for either.
4. **Boundary discipline** — `JSON.parse`, raw `fetch`/`globalThis.fetch`/third-party HTTP libraries (`got`/`axios`/`node-fetch`/`undici`)/`new URL`, `child_process`, polling `setTimeout` outside permitted homes. Read the per-package table — the CLI has no home for `JSON.parse`, `new URL`, or a wait loop, and delegates all three to the client.
   4a. **Package boundary** — an import in `packages/client/**` that resolves into `packages/cli` (by `@metabase/cli` specifier or by a relative path escaping the client's src tree) is FAIL. A production client file importing anything beyond `zod`, `semver`, and `node:` builtins is FAIL. A CLI file reaching into the client by relative path instead of the `@metabase/client/<path>` specifier is FAIL. `packages/cli/src/output/**` importing `@metabase/client/http/**` is FAIL. Anything outside `client.ts` and `resources/` importing `resources/` is FAIL.
   4b. **Request placement** — a file under `packages/cli/src/commands/` that names an `/api/…` path literal, or calls `requestParsed`/`requestRaw`/`requestStream`/`paginatePages`, is FAIL. Quote the path template and name the resource method it belongs on.
5. **Resource contract** — every new or changed resource in `packages/client/src/domain/` exports `<Resource>` (with `.loose()`) and `<Resource>Compact` (with `.pick({...}).strip()` — the trailing `.strip()` is mandatory), and its `<resource>View` lives CLI-side in `packages/cli/src/output/views/<r>.ts` (a `ResourceView`/`ColumnDef`/`tableColumns` in the domain file is FAIL); naming follows the convention; commands consume `z.infer<typeof Schema>` rather than `Array<Record<string, unknown>>` or inline `as { ... }` casts. Every new or changed method in `packages/client/src/resources/` satisfies all eight conventions above, is composed onto `client.ts`, and returns a domain value rather than the server's envelope.
6. **List windowing** — a list command builds its envelope with one of the three helpers in `packages/cli/src/output/window.ts`, picked by who applied the window: `windowList(data, ctx.range, total)` when the method returned the whole result set as a `ListResult<T>` and the slice is client-side (the common case); `windowServerPage(data, total, ctx.range)` when the endpoint applied `limit`/`offset` itself and reports a count; `collectForOutput(source, view, ctx)` for a genuinely paged endpoint, where `source` is a `PageSource<T>` forwarding the helper's `PageRequest` (`max`, `pageSize`) into the resource's `<thing>Pages` method. A source that drops `max` or `pageSize` is FAIL — the byte budget cannot bound the walk. A hand-rolled envelope literal is FAIL — it produces a plausible shape whose `has_more`/`next_offset` no test catches. A list verb missing `...listFlags`, or one that never reads `ctx.range`, is FAIL: the `--limit`/`--offset` an agent needs to page silently do nothing.
7. **Test parity** — rules above.
8. **Comment hygiene** — no WHAT-comments; no task/PR/issue/external-path references; no comments-as-history.
9. **Imports / extensions** — no `from "...\.(ts|js)";`. Type-only imports use `import type`.
10. **TS escape hatches** — no `// @ts-ignore`, `// @ts-nocheck`, `// @ts-expect-error` without paired `reason:` + `FIXME(date)`.
11. **Reuse / supersession** — for each new helper, grep **both packages** for existing helpers covering the same intent; a CLI helper duplicating something the client already exports (`parseJson`, `pollUntil`, `paginatePages`, `errorMessage`, `normalizeUrl`) is the common case and is FAIL. A new helper that subsumes an older narrower one without deleting the old one is FAIL.
12. **Type drift** — a hand-written `interface`/`type` whose keys mirror an in-repo value's shape (could be `typeof X`, mapped over `keyof typeof X`, or a library generic like `ParsedArgs<typeof cmd.args>`) is FAIL. Hand-maintained parallel definitions drift silently.
13. **Catch-all directories** — new files under `_shared/`, `_helpers/`, `_utils/`, `common/`, `lib/`, `misc/`, or any other bucket-name directory is FAIL. Files must be named by purpose.
14. **Test quality** — assertions over a structure must be full (`toEqual(<full object>)` / `toEqual(<full array>)`) — single-property pokes when the whole object is observable is FAIL (e.g. a sequence of `expect(parsed.id).toBe(...)` / `expect(parsed.name).toBe(...)` after `parseJson` collapses to one `toEqual({...})`). Redundant assertions (e.g. asserting `.length` before `toEqual` of the array) is FAIL. Error assertions that check only the type or only the message — never both — is FAIL. Fixture fields that no test reads (and are not structurally required to satisfy a type) is FAIL.
    - **Exit codes:** `expect(<r>.exitCode).not.toBe(0)` is FAIL. Assert the exact integer — `toBe(2)` for `ConfigError`, `toBe(130)` for `AbortError`, `toBe(2)` for `CapabilityError`, `toBe(1)` for everything else (`HttpError`, `ValidationError`, `NetworkError`, `TimeoutError`, `UnknownError`). The taxonomy lives in `packages/client/src/errors.ts` (`CapabilityError` in `packages/client/src/version/preflight-error.ts`); if you can't tell which code is right, the test isn't asserting the contract you think it is.
    - **Error strings:** `expect(<stream>).toMatch(/.../i)` for stderr / error messages is FAIL. Use `toContain("<exact substring>")` or `toBe("<exact full string>")`. The narrow exception is asserting _absence_ of a pattern (`expect(out).not.toMatch(/pattern/)`). Where the message contains a dynamic value (a byte count, a generated id, a path), build the expected string from the same data the production code consumed and assert with `toBe`. Replacing the dynamic part with `\d+` or `.*` in a regex is FAIL.
    - **e2e stderr:** the harness is never a TTY, so the CLI writes a JSON error envelope to stderr. `expect(<r>.stderr).toBe("<message>")` can never match and is FAIL — stderr carries the envelope plus any leading `warn()` lines. Assert through `cliErrorMessage(<r>.stderr)` from `tests/e2e/cli-error.ts`. A raw `expect(<r>.stderr).toContain(...)` is acceptable for a plain substring, but is FAIL when the expected message contains a quote, backslash, or newline — the envelope JSON-escapes those, so the raw substring is absent and only `cliErrorMessage` sees the real text.
15. **README parity** — the root `README.md` is the user-facing command reference and must document every command in `packages/cli/src/commands/` (each group exported as a top-level subcommand). Adding a new command, renaming one, removing one, or changing a flag's name/description without a matching root `README.md` update is FAIL. Adding/removing a flag in `GLOBAL_FLAG_ARGS` (`packages/cli/src/commands/global-flags.ts`, composed from `outputFlags` / `profileFlag` / `connectionFlags` in `packages/cli/src/commands/flags.ts`) without updating the common-flags section is FAIL. A change to a root script (`bun run check`, the `e2e:*` family) without updating the "Working in the repo" section is FAIL. `packages/client/README.md` is the client's own reference, governed by the barrel exports in `packages/client/src/index.ts` and the `domain/` pair contract — adding, removing, or renaming a barrel export, or changing a documented `<Resource>`/`<Resource>Compact` sample so it diverges from the schema, without updating it is FAIL. `packages/cli/README.md` is a pointer to the root one for the npm page — a diff that grows it into a second command reference is FAIL.
16. **Fail-fast boundaries** — boundary code (JSON parsing, file I/O, HTTP response handling, stdin reads) must throw or return a typed error on malformed input. Diff that introduces silent coercion to `{}`/`[]`/`""`, `?? ""`/`?? 0`/`?? []`/`?? {}` to satisfy a type when the real meaning is "absent" or "error", empty `catch {}` blocks, or `try`/`catch` that swallows the error and returns a default — is FAIL. Quote the offending site.
17. **Magic literals** — diff introduces a numeric or string literal that already appears elsewhere in the repo without a shared constant (timeouts, byte caps, exit codes, profile names, account identifiers, file modes). Grep both packages for the literal before deciding; one occurrence is fine, two without a constant is FAIL.
18. **Boolean traps** — diff adds a function with 2+ boolean parameters, or a call site with 2+ positional boolean arguments where intent is non-obvious from the call. Use a named-options object or split functions. FAIL.
19. **Type-guard validity** — a function declared `(value): value is T` must validate the property that distinguishes `T`. `instanceof Error` narrowing to a more specific error subtype, or any guard whose body cannot rule out a non-`T` input, is a hidden cast and FAIL.
20. **Eloquence** — diff introduces ceremony that has no real-world counterpart. Stacked `override readonly` chains where a plain assignment would do, intermediate abstract classes that exist solely to deduplicate four lines, generic parameters that don't earn their complexity, option-bag wrappers around single-arg calls — FAIL. The test: would two engineers writing this from scratch both reach for this pattern? If no, it's overengineered. Quote the offending construct and a simpler alternative.
21. **Expression complexity** — diff introduces a big inline boolean or ternary chain in an `if`, `return`, or assignment. Multi-clause `&&`/`||` mixes, `?.` ladders combined with `??` fallbacks, or nested ternaries (`a ? x : b ? y : z`) inside a conditional are FAIL. Each meaningful clause should be a named local (`const hasBudget = …; const isFresh = …`). The condition in the `if` should read as one phrase, not a puzzle. Quote the offending site.
22. **Mocking discipline** — `vi.mock(...)` is a last resort. Diff introduces a module mock to test a one-line wrapper / one-line delegation, or to substitute logic owned by the system under test, is FAIL — that test asserts only what the mock was configured to return (a tautology). Acceptable: hermetic isolation of side-effecting external deps in integration tests where the real path pollutes the host (e.g. `@napi-rs/keyring`, real network, real subprocess), or fixture injection into a fully-exercised pipeline. Not acceptable: mocking an internal module so a unit test can fire a single branch — instead prefer a real value flowing through real imports (real `ZodError`, real `HttpError`, real Zod schema), or push the coverage to the smoke/integration tier. Prefer integration over isolation when in doubt. Quote any `vi.mock` call and the one-line wrapper it shadows.
23. **E2E CLI invocation discipline** — under `tests/e2e/**/*.e2e.test.ts`, any direct call to `execa`, `spawn`, `exec`, or `child_process` is FAIL — e2e tests drive the binary through `runCli` from `tests/e2e/run-cli.ts`. Inline `fetch(<metabase-url>...)` from a test file is FAIL — credential setup belongs in `tests/e2e/setup/bootstrap.ts` and tests read state via `readBootstrap()`.
24. **Bootstrap-data unity** — the `Bootstrap` Zod schema (the `.bootstrap.json` shape) and the `BOOTSTRAP_FILE_PATH` constant must live only in `tests/e2e/bootstrap-data.ts`. Any redeclaration of the same shape elsewhere (typically in `tests/e2e/setup/bootstrap.ts`) is FAIL — writer and reader share one source.
25. **Test schema reuse** — when a production module exports a Zod schema describing CLI output, tests must import it from wherever it lives. Schemas that fall under this rule include: per-command output schemas (e.g. `LoginResult`, `AuthStatus`) and every `<Resource>ListEnvelope` exported from `packages/cli/src/commands/<noun>/list.ts` (built via `listEnvelopeSchema(<Resource>Compact)` from `packages/cli/src/output/types.ts`), plus every `<Resource>` / `<Resource>Compact` in `packages/client/src/domain/`. A test file that declares a `z.object({...})` mirroring the same fields as a known export — including hand-rolling a list-envelope shape (`{ data, returned, offset, limit, total, has_more, next_offset, truncated }`) instead of importing the command's `<Resource>ListEnvelope` — is FAIL. Quote both the test declaration and the canonical export.
26. **Helper reuse in tests** — test code reimplementing a helper the client already exports (e.g. inline `JSON.parse` + `Schema.parse` instead of `parseJson` from `@metabase/client/json`; `error.code === "ENOENT"` instead of `isFileNotFoundError` from `@metabase/client/errors`; deadline+sleep loops instead of `pollUntil` from `@metabase/client/poll`) is FAIL. Test files are allowed to import these across the layering and package boundaries because the layering rules apply to production source only.
27. **License-token discipline** — diff that introduces (a) a hardcoded real EE token (any string matching `^mb_(dev_[0-9a-f]{57}|[0-9a-f]{64})$` outside a clearly-fake placeholder like `mb_dev_0123…`), (b) `console.log` / `process.std*.write` / `Bash(echo $...)` / `Read(.env*)` of `MB_PREMIUM_EMBEDDING_TOKEN` or `METASTORE_DEV_SERVER_URL` or any binding holding their value, (c) writing the token to a file outside the test process's stdin pipe, (d) an assertion `toContain` / `toEqual` / `toBe` that compares against the token string is FAIL. Acceptable: `process.env["MB_PREMIUM_EMBEDDING_TOKEN"] === ""` for skip-gating; `runCli({ stdin: token })` to thread the token opaquely. Quote the offending site.

## Output format

```
| # | Axis | Status | Detail |
|---|------|--------|--------|
| 1 | Layering | PASS | |
| 2 | Type strictness | FAIL | packages/cli/src/commands/card/get.ts:12 — `as unknown as Card` |
| 3 | Output discipline | PASS | |
...
```

Then exactly one of:

- `RESULT: PASS — task may be marked done.`
- `RESULT: FAIL (<n> failures, <m> unknowns) — fix issues above before marking done.`

If FAIL, follow the table with a bulleted list of the next concrete actions to address each failure (one bullet per FAIL, with `path:line`).

## Rules for the review itself

- Read-only. Do not modify any files.
- Do not run `tsc`, `oxlint`, `oxfmt`, or the test suites here. Those are separate; this skill is the architectural / non-deterministic layer.
- Do not green-light by default. If you cannot determine an axis from the diff, mark `UNKNOWN` with the reason — never PASS.
- Be ruthless. The point of this skill is to be strict where the type-checker can't be.
