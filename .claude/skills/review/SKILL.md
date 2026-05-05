---
name: review
description: Strict end-of-task review. Use before marking any non-trivial task done. Returns axis-by-axis pass/fail; any FAIL blocks completion. Trigger on user /review or end-of-task self-check.
---

# review

Non-deterministic architectural check that complements `npm run check`. Determinism catches typos; this catches drift.

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

```
src/cli.ts                  entrypoint; only file allowed to call process.exit
src/main.ts                 root citty command, lazy subCommands
src/commands/               CLI shell — citty defineCommand, flags, prompts, orchestration
src/core/                   pure logic, no CLI deps
  src/core/auth/            credential storage + verification
  src/core/config.ts        flag → env → file resolver
  src/core/errors.ts        type guards: isNodeError, isNotFoundError, errorMessage
  src/core/url.ts           normalizeUrl
  src/core/http/            native-fetch-backed client + error taxonomy
src/domain/                 Metabase API resource Zod schemas + inferred types
src/output/                 presentation; takes typed values; renders text or JSON
src/runtime/                platform glue: stdin, poll, json, input, process
```

Allowed import direction:

- `commands/*` may import `core/*`, `domain/*`, `output/*`, `runtime/*`.
- `core/*` may import `domain/*`, `runtime/*`. Never `commands/`.
- `output/*` may import `domain/*`, `runtime/*`, and `core/*` except `core/auth/`. Never `commands/`, `core/auth/`.
- `runtime/*` imports nothing from `commands/`, `core/`, `domain/`, `output/`.
- `domain/*` imports only `zod` and other `domain/*` files. Nothing from elsewhere.

## Domain-file contract

Every Metabase API resource in `src/domain/<resource-singular>.ts` exports exactly three things per resource:

1. **`<Resource>`** — `z.object({ ... }).loose()` for the full API shape, with the type inferred via `z.infer`. `.loose()` is the default so Metabase API additions don't break the parse — tighten over time, don't preempt. (Zod 4 — `.passthrough()` is deprecated; use `.loose()`.)
2. **`<Resource>Compact`** — `<Resource>.pick({ ... }).strip()` projection with its inferred type. The trailing `.strip()` is **mandatory**: `.pick()` on a `.loose()` parent inherits the loose catchall and silently passes every API field through at parse time, which means the "compact" projection isn't actually compact. A diff that lands a Compact missing `.strip()` is FAIL — quote `<Resource>.pick({...})` without trailing `.strip()`.
3. **`<resource>View`** — `ResourceView<T>` with `compactPick: <Resource>Compact` and `tableColumns: ColumnDef<T>[]`. Consumed by `src/output/render`; inlining a column list inside a command is FAIL.

Naming: `<Resource>` is PascalCase (`Card`); `<resource>View` is camelCase (`cardView`). `<Resource>` is the _resource name_, not the file name — a file may host multiple resources (e.g. `domain/user.ts` → `CurrentUser` + `CurrentUserCompact` + `userView`); the three-export contract holds per-resource.

Adding a resource is additive: a new `src/domain/<r>.ts`. Editing existing commands to wire the schema is FAIL — commands import what they need. Do **not** require a `tests/fixtures/<r>/sample.json` + parse-test pair — that is a tautology against Zod itself. The schema is contract-tested by the e2e tier when a command consuming it runs against the live API.

A new or modified API resource without all three exports, or that omits `.loose()` on the full schema, or that omits `.strip()` after `.pick()` on the Compact, or that hand-rolls `Array<Record<string, unknown>>` / inline `as { ... }` casts in commands instead of consuming `z.infer<typeof Schema>`, is a structural failure.

`Record<string, unknown>` is forbidden in command files. The single exemption is `src/output/projection.ts` — the canonical structurally-untyped envelope for dot-path `--fields` projection over already-validated payloads.

## Forbidden patterns and their permitted homes

The src-side rules are enforced by `tests/structure.test.ts` for files under `src/`. Test files are out of that walker's scope, but the e2e-side restrictions below are still part of this review.

| Pattern                                                                                        | Permitted only in                                                                   |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `process.exit(`                                                                                | `src/cli.ts`, `tests/e2e/setup/bootstrap.ts`                                        |
| `process.stdout.write`, `process.stderr.write`                                                 | `src/cli.ts`, `src/output/**`, `tests/e2e/setup/bootstrap.ts`                       |
| `console.{log,warn,error,info,debug}`                                                          | `src/cli.ts`, `src/output/**`                                                       |
| `JSON.parse(`                                                                                  | `src/runtime/json.ts`                                                               |
| bare `fetch(`, `globalThis.fetch`, third-party HTTP libs (`got`/`axios`/`node-fetch`/`undici`) | `src/core/http/**`, `tests/e2e/setup/**`                                            |
| `new URL(`                                                                                     | `src/core/http/**`, `src/core/url.ts`                                               |
| `child_process` (`spawn`, `exec`, etc.), `execa`                                               | `src/runtime/process.ts`, `tests/e2e/run-cli.ts`, `tests/e2e/setup/global-setup.ts` |
| `setTimeout` inside an `await` polling loop                                                    | `src/runtime/poll.ts`                                                               |
| Hand-written ENOENT shape check (`error.code === "ENOENT"`)                                    | nowhere — use `isNotFoundError` from `src/core/errors`                              |
| Inline `JSON.parse(...) ; Schema.parse(...)`                                                   | nowhere — use `parseJson(raw, Schema, { source })` from `src/runtime/json.ts`       |

## Type strictness rules (always)

- No `as` cast in any form: `as X`, `as unknown as`, `as never`, `as any`. Use type guards or Zod `.parse`.
- No `any` in declared types.
- No `Record<string, unknown>` used as a typed value (it is allowed only inside the structurally-untyped output envelope).
- No `!` non-null assertions.
- No `// @ts-ignore`, `// @ts-nocheck`, `// @ts-expect-error` (paired comment with `// reason:` and `// FIXME(date)` only).
- Every cross-network value passes through Zod `.parse` before downstream code touches it.
- Imports are extensionless. Type-only imports use `import type`.

## Test-parity rules

- New `src/commands/<noun>/<verb>.ts` ⇒ a `tests/e2e/<noun>.e2e.test.ts` exists and exercises that subcommand end-to-end via `runCli`. Adding a new command without an e2e test is FAIL.
- New `src/commands/<noun>/<verb>.ts` (any leaf) ⇒ `tests/e2e/manifest.e2e.test.ts`'s literal `commandPaths` list includes the new path. Renaming or deleting a command without updating the list is FAIL.
- New `src/domain/<r>.ts` ⇒ no fixture-and-parse-test pair required. A unit test of the form `Schema.parse(fixture).toEqual(fixture)` is a tautology against Zod and is FAIL if introduced. The schema's contract is tested by the e2e tier hitting the live API.
- New pure helper in `core/`, `output/`, `runtime/` ⇒ a unit test imports from it.
- New helper with infinite input space (URL parsing, JSON parsing, projection, byte cap, polling) ⇒ a property test (`fast-check`).

## E2E test contract

- E2E tests drive the CLI through `runCli` from `tests/e2e/run-cli.ts`. Direct `execa`, `spawn`, or `child_process` calls inside `tests/e2e/**/*.e2e.test.ts` are FAIL.
- E2E tests read admin credentials via `readBootstrap()` from `tests/e2e/bootstrap-data.ts`. Inline `fetch` to Metabase, hard-coded API keys, or calls to `/api/setup` from a test are FAIL.
- The `Bootstrap` Zod schema and `BOOTSTRAP_FILE_PATH` constant live only in `tests/e2e/bootstrap-data.ts`. Re-declaring either in `tests/e2e/setup/bootstrap.ts` (or anywhere else) is FAIL — the writer imports from the reader to prevent shape drift.
- `--json` output assertions parse through the schema imported from `src/commands/<noun>/<verb>.ts` (e.g. `LoginResult`, `AuthStatus`) or `src/domain/<r>.ts`. Re-declaring a `z.object({...})` in a test that mirrors a `src/` export is FAIL.
- Each test or test-group gets its own `XDG_CONFIG_HOME` via `mkTempConfigHome()`. Sharing config home across tests that mutate credentials is FAIL.

## Axes (output one row per axis)

For each axis below, output `PASS`, `FAIL`, or `UNKNOWN`. For every `FAIL` and `UNKNOWN`, quote the offending snippet with `path:line` and a one-sentence explanation.

1. **Layering** — direction rules above.
2. **Type strictness** — rules above.
3. **Output discipline** — `console.*`, `process.exit`, `process.std*.write` outside permitted homes.
4. **Boundary discipline** — `JSON.parse`, raw `fetch`/`globalThis.fetch`/third-party HTTP libraries (`got`/`axios`/`node-fetch`/`undici`)/`new URL`, `child_process`, polling `setTimeout` outside permitted homes.
5. **Domain contract** — every new or changed resource in `src/domain/` exports `<Resource>` (with `.loose()`), `<Resource>Compact` (with `.pick({...}).strip()` — the trailing `.strip()` is mandatory), and `<resource>View`; naming follows the convention; commands consume `z.infer<typeof Schema>` rather than `Array<Record<string, unknown>>` or inline `as { ... }` casts.
6. **Test parity** — rules above.
7. **Comment hygiene** — no WHAT-comments; no task/PR/issue/external-path references; no comments-as-history.
8. **Imports / extensions** — no `from "...\.(ts|js)";`. Type-only imports use `import type`.
9. **TS escape hatches** — no `// @ts-ignore`, `// @ts-nocheck`, `// @ts-expect-error` without paired `reason:` + `FIXME(date)`.
10. **Reuse / supersession** — for each new helper, grep `src/` for existing helpers covering the same intent. New code that duplicates an existing utility is FAIL. A new helper that subsumes an older narrower one without deleting the old one is FAIL.
11. **Type drift** — a hand-written `interface`/`type` whose keys mirror an in-repo value's shape (could be `typeof X`, mapped over `keyof typeof X`, or a library generic like `ParsedArgs<typeof cmd.args>`) is FAIL. Hand-maintained parallel definitions drift silently.
12. **Catch-all directories** — new files under `_shared/`, `_helpers/`, `_utils/`, `common/`, `lib/`, `misc/`, or any other bucket-name directory is FAIL. Files must be named by purpose.
13. **Test quality** — assertions over a structure must be full (`toEqual(<full object>)` / `toEqual(<full array>)`) — single-property pokes when the whole object is observable is FAIL (e.g. a sequence of `expect(parsed.id).toBe(...)` / `expect(parsed.name).toBe(...)` after `parseJson` collapses to one `toEqual({...})`). Redundant assertions (e.g. asserting `.length` before `toEqual` of the array) is FAIL. Error assertions that check only the type or only the message — never both — is FAIL. Fixture fields that no test reads (and are not structurally required to satisfy a type) is FAIL.
    - **Exit codes:** `expect(<r>.exitCode).not.toBe(0)` is FAIL. Assert the exact integer — `toBe(2)` for `ConfigError`, `toBe(130)` for `AbortError`, `toBe(1)` for everything else (`HttpError`, `ValidationError`, `NetworkError`, `TimeoutError`, `UnknownError`). The taxonomy lives in `src/core/errors.ts`; if you can't tell which code is right, the test isn't asserting the contract you think it is.
    - **Error strings:** `expect(<stream>).toMatch(/.../i)` for stderr / error messages is FAIL. Use `toContain("<exact substring>")` or `toBe("<exact full string>")`. The narrow exception is asserting _absence_ of a pattern (`expect(out).not.toMatch(/pattern/)`). Where the message contains a dynamic value (a byte count, a generated id, a path), build the expected string from the same data the production code consumed and assert with `toBe`. Replacing the dynamic part with `\d+` or `.*` in a regex is FAIL.
14. **README parity** — `README.md` must document every command in `src/commands/` (each `defineCommand` exported as a top-level subcommand). Adding a new command, renaming one, removing one, or changing a flag's name/description without a matching `README.md` update is FAIL. Adding/removing a flag in `commonFlags` without updating the common-flags section is FAIL. If `README.md` is absent, mark FAIL with reason "no README to keep in sync" so the project owner is on notice.
15. **Fail-fast boundaries** — boundary code (JSON parsing, file I/O, HTTP response handling, stdin reads) must throw or return a typed error on malformed input. Diff that introduces silent coercion to `{}`/`[]`/`""`, `?? ""`/`?? 0`/`?? []`/`?? {}` to satisfy a type when the real meaning is "absent" or "error", empty `catch {}` blocks, or `try`/`catch` that swallows the error and returns a default — is FAIL. Quote the offending site.
16. **Magic literals** — diff introduces a numeric or string literal that already appears elsewhere in the repo without a shared constant (timeouts, byte caps, exit codes, profile names, account identifiers, file modes). Grep `src/` for the literal before deciding; one occurrence is fine, two without a constant is FAIL.
17. **Boolean traps** — diff adds a function with 2+ boolean parameters, or a call site with 2+ positional boolean arguments where intent is non-obvious from the call. Use a named-options object or split functions. FAIL.
18. **Type-guard validity** — a function declared `(value): value is T` must validate the property that distinguishes `T`. `instanceof Error` narrowing to a more specific error subtype, or any guard whose body cannot rule out a non-`T` input, is a hidden cast and FAIL.
19. **Eloquence** — diff introduces ceremony that has no real-world counterpart. Stacked `override readonly` chains where a plain assignment would do, intermediate abstract classes that exist solely to deduplicate four lines, generic parameters that don't earn their complexity, option-bag wrappers around single-arg calls — FAIL. The test: would two engineers writing this from scratch both reach for this pattern? If no, it's overengineered. Quote the offending construct and a simpler alternative.
20. **Expression complexity** — diff introduces a big inline boolean or ternary chain in an `if`, `return`, or assignment. Multi-clause `&&`/`||` mixes, `?.` ladders combined with `??` fallbacks, or nested ternaries (`a ? x : b ? y : z`) inside a conditional are FAIL. Each meaningful clause should be a named local (`const hasBudget = …; const isFresh = …`). The condition in the `if` should read as one phrase, not a puzzle. Quote the offending site.
21. **Mocking discipline** — `vi.mock(...)` is a last resort. Diff introduces a module mock to test a one-line wrapper / one-line delegation, or to substitute logic owned by the system under test, is FAIL — that test asserts only what the mock was configured to return (a tautology). Acceptable: hermetic isolation of side-effecting external deps in integration tests where the real path pollutes the host (e.g. `@napi-rs/keyring`, real network, real subprocess), or fixture injection into a fully-exercised pipeline. Not acceptable: mocking an internal module so a unit test can fire a single branch — instead prefer a real value flowing through real imports (real `ZodError`, real `HttpError`, real Zod schema), or push the coverage to the smoke/integration tier. Prefer integration over isolation when in doubt. Quote any `vi.mock` call and the one-line wrapper it shadows.
22. **E2E CLI invocation discipline** — under `tests/e2e/**/*.e2e.test.ts`, any direct call to `execa`, `spawn`, `exec`, or `child_process` is FAIL — e2e tests drive the binary through `runCli` from `tests/e2e/run-cli.ts`. Inline `fetch(<metabase-url>...)` from a test file is FAIL — credential setup belongs in `tests/e2e/setup/bootstrap.ts` and tests read state via `readBootstrap()`.
23. **Bootstrap-data unity** — the `Bootstrap` Zod schema (the `.bootstrap.json` shape) and the `BOOTSTRAP_FILE_PATH` constant must live only in `tests/e2e/bootstrap-data.ts`. Any redeclaration of the same shape elsewhere (typically in `tests/e2e/setup/bootstrap.ts`) is FAIL — writer and reader share one source.
24. **Test schema reuse** — when an `src/` module exports a Zod schema describing CLI output, tests must import it. Schemas that fall under this rule include: per-command output schemas (e.g. `LoginResult`, `AuthStatus`), every `<Resource>` / `<Resource>Compact` in `src/domain/`, and every `<Resource>ListEnvelope` exported from `src/commands/<noun>/list.ts` (built via `listEnvelopeSchema(<Resource>Compact)` from `src/output/types.ts`). A test file that declares a `z.object({...})` mirroring the same fields as a known `src/` export — including hand-rolling a list-envelope shape (`{ data, returned, total }`) instead of importing the command's `<Resource>ListEnvelope` — is FAIL. Quote both the test declaration and the canonical export.
25. **Helper reuse in tests** — test code reimplementing a helper that already lives in `src/runtime/` or `src/core/errors` (e.g. inline `JSON.parse` + `Schema.parse` instead of `parseJson`; `error.code === "ENOENT"` instead of `isNotFoundError`; deadline+sleep loops instead of `pollUntil`) is FAIL. Test files are allowed to import these helpers across the layering boundary because the layering rules don't apply to `tests/`.
26. **License-token discipline** — diff that introduces (a) a hardcoded real EE token (any string matching `^mb_(dev_[0-9a-f]{57}|[0-9a-f]{64})$` outside a clearly-fake placeholder like `mb_dev_0123…`), (b) `console.log` / `process.std*.write` / `Bash(echo $...)` / `Read(.env*)` of `MB_PREMIUM_EMBEDDING_TOKEN` or `METASTORE_DEV_SERVER_URL` or any binding holding their value, (c) writing the token to a file outside the test process's stdin pipe, (d) an assertion `toContain` / `toEqual` / `toBe` that compares against the token string is FAIL. Acceptable: `process.env["MB_PREMIUM_EMBEDDING_TOKEN"] === ""` for skip-gating; `runCli({ stdin: token })` to thread the token opaquely. Quote the offending site.

## Output format

```
| # | Axis | Status | Detail |
|---|------|--------|--------|
| 1 | Layering | PASS | |
| 2 | Type strictness | FAIL | src/foo.ts:12 — `as unknown as Card` |
| 3 | Output discipline | PASS | |
...
```

Then exactly one of:

- `RESULT: PASS — task may be marked done.`
- `RESULT: FAIL (<n> failures, <m> unknowns) — fix issues above before marking done.`

If FAIL, follow the table with a bulleted list of the next concrete actions to address each failure (one bullet per FAIL, with `path:line`).

## Rules for the review itself

- Read-only. Do not modify any files.
- Do not run `npm run check` or other deterministic gates here. Those are separate; this skill is the architectural / non-deterministic layer.
- Do not green-light by default. If you cannot determine an axis from the diff, mark `UNKNOWN` with the reason — never PASS.
- Be ruthless. The point of this skill is to be strict where the type-checker can't be.
