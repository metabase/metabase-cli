# CLAUDE.md

Metabase CLI and the `@metabase/client` package it is built on. TypeScript ESM. citty + native `fetch` + Zod + @clack/prompts. oxlint + oxfmt. vitest. tsdown.

This file is rules only. Architecture and rationale live in `docs/architecture.md`; workflows live in the skills under `.claude/skills/`.

## Types

- No `as` casts (`as X`, `as unknown as X`, `as never`, `as any`). Use type guards or Zod `.parse` at boundaries. `as const` is fine.
- No `any`. No `Record<string, unknown>` for API responses — every cross-network value gets a named Zod schema in the client's `domain/`, parsed at the boundary. Sole exemption: `packages/cli/src/output/projection.ts`.
- No `!` non-null assertions. Restructure with a helper returning a named result-or-`null` interface, as `packages/cli/src/core/config.ts` does with `resolveUrl` / `resolveCredential`.
- No inline object types in unions, returns, or params. Name them via `interface` or `type`.
- Derive types from values (`typeof X`, mapped types over `keyof typeof X`, citty's `ParsedArgs<typeof cmd.args>`). A hand-written interface mirroring a value's shape drifts silently.
- Type guards must check the property that distinguishes what they narrow, not a weaker shared one.

## Code

- No file extensions in imports (`./foo`, not `./foo.ts`). `import type` for type-only imports.
- No comments unless the WHY is non-obvious. Never WHAT, never task/PR/path refs. This applies to prose docs too — describe the end state, never the change to it. Delete on sight: "now", "no longer", "previously", "used to", "the new …", "moved to", "renamed".
- Fail fast at boundaries. JSON parsing, file reads, HTTP responses throw or return a typed error on malformed input. Empty `catch {}` is forbidden.
- No placeholder fallbacks for absent state. `?? ""` / `?? 0` / `?? []` / `?? {}` to satisfy a type when the semantic is "missing" hides bugs — model absence with `null` or a discriminated union.
- No magic literals. Recurring constants (byte caps, timeouts, exit codes, file modes) get a named constant colocated with the canonical user.
- No boolean traps. 2+ boolean params becomes a named-options object or two functions.
- No big inline expressions. Split into semantically-named locals; flatten ternary chains with early returns or a lookup.
- Prefer the simplest realistic expression. No ceremony — repeated `override readonly`, generic gymnastics, intermediate abstract classes — where a plain field or early return is clearer.
- When a new helper subsumes an older narrower one, delete the older one in the same change.
- An `export` in `packages/cli` needs an importer outside its own file; a `*.test.ts` importer counts. The CLI ships as a bundled binary with no `exports`/`main`/`types`, so a symbol nothing imports is exported for nobody. `packages/client` is exempt — its `exports` map makes any named module public surface.
- Never fake green. No `oxlint-disable`, no `@ts-expect-error`, no `.skip`/`.todo` on a test that used to run, no weakening an assertion to match wrong output, no silently narrowing scope. If it can't pass honestly, stop and report the blocker.

## Layout

| Path              | What                                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `packages/client` | Private Metabase API client: Zod `domain/` schemas, `resources/` methods, `http/` boundary, OAuth, version/capabilities |
| `packages/cli`    | Publishable CLI: `commands/` (shell only), `core/` (pure logic), `output/` (presentation), `runtime/` (platform glue)   |
| `tests/e2e`       | Built-binary tier against a live Metabase                                                                               |

- Nothing in `packages/client` may import from `packages/cli`, touch `process`, or mutate process-global state. Its dependency budget is `zod` (peer) + `semver` + `node:` builtins.
- Within `packages/client`, only `client.ts` and `resources/` may import from `resources/`. The CLI may `import type` from the resource subpaths the `exports` map publishes.
- `JSON.parse` only in `json.ts`. `fetch` only in `http/` (plus `packages/cli/src/core/npm-registry.ts`, which is not a Metabase endpoint). `new URL(` only in `url.ts` and `http/`. Within `packages/client`, a `setTimeout` wait loop only in `poll.ts` and `http/retry.ts`; in `packages/cli`, a hand-rolled one nowhere — wait on `node:timers/promises`.
- `process.exit` only in the CLI entry; `process.stdout.write` only in `output/`; `child_process` only in `runtime/process.ts`. `src/output/` must not import the HTTP layer — reach for `@metabase/client/errors`.
- TLS trust is the host application's to configure, so `node:tls` appears nowhere in `packages/client`; the CLI opts in for itself via `core/system-ca.ts`.
- Every `MB_` env var name is a const in `packages/cli/src/core/env.ts` and is read through `readEnv`, never raw `process.env[...]`. `MB_URL` / `MB_API_KEY` are read in `core/config.ts` only.
- Multi-instance commands use profiles (`--from-profile` / `--to-profile`) routed through the same `resolveConfig`. No `MB_SOURCE_*` family, no parallel client getter.
- A directory earns subfolders at ~8–10 files **and** 2+ concern-clusters. Single-role directories (`domain/`, `commands/<noun>/`) stay flat at any size. Never create a folder for one file.
- Never add: a catch-all module or bucket directory (`api.ts`, `schemas.ts`, `lib/`, `_shared/`, `_utils/`, `common/`, `misc/`); a third-party HTTP library; a dotenv parser (use `--env-file`); a color library; a dependency for a one-off helper.

## Commands

- Use `defineMetabaseCommand({ meta, args, capabilities, run })` from `commands/runtime.ts`, never citty's `defineCommand`. Spread the shared flag sets from `commands/flags.ts` (`outputFlags`, `profileFlag`, `connectionFlags`, plus `listFlags` for a list command). A new global flag must also be added to `GLOBAL_FLAG_ARGS` in `commands/global-flags.ts` or it will not survive hoisting.
- Commands call the client, never the wire. An `/api/` path literal or a `requestParsed` / `requestRaw` / `requestStream` / `paginatePages` call inside `src/commands/` belongs in `resources/`. Both rules are absolute and carry no allowlist. The one sanctioned request a command issues by name is `tryDiscoverMetadata` in `auth/login.ts`, which runs before there is a transport to hang it on.
- Every command declares `capabilities` explicitly: `{ minVersion }` (bare Metabase major, e.g. `58`) and/or `{ tokenFeature }`, `{}` for the v58 baseline, or `null` for a command that never reaches a server. The field is required, so an omission is a compile error. Baseline and `null` commands never preflight.
- Import prompts from `output/prompt.ts`, never `@clack/prompts` directly — that is where cancel becomes `AbortError`.
- Anything that can block takes `interruptSignal` explicitly: client construction, every `WaitSchedule`, any long-running fetch.

## Schemas

Every resource lives in `packages/client/src/domain/<resource-singular>.ts` and exports exactly two things:

1. **`<Resource>`** — `z.object({...}).loose()`, type aliased via `z.infer`. Loose so API additions don't break us.
2. **`<Resource>Compact`** — `<Resource>.pick({...}).strip()`. The trailing `.strip()` is mandatory: Zod 4's `.pick()` inherits a `.loose()` parent's catchall and silently passes every field through without it.

- Trim to what an agent needs: ids, names, FK targets, base/semantic types, descriptions. Drop sync flags, fingerprints, timestamps, internal plumbing.
- Pin closed enums with `z.enum([...])` where the backend enumerates the values, so a new server value fails loudly instead of passing as an untyped string.
- Presentation is the CLI's: the terminal binding is `<resource>View` in `packages/cli/src/output/views/<r>.ts`. Never inline a column list in a command; never put a `ColumnDef` on the client surface.
- Resource methods (`packages/client/src/resources/<r>.ts`) are the only layer naming an `/api/` path. Path params positional, then params, then options; params use Metabase's own field names verbatim with no mapping layer; transport concerns (`signal`, `timeoutMs`, `retries`) only in the trailing options; wire envelopes stay module-private; methods return domain values, and a non-paginated list returns `ListResult<T>`; every string path param goes through `encodeURIComponent`; every method carries the endpoint's description as a doc comment.
- List commands wrap items in `ListEnvelope<T>` via one of `windowList` / `windowServerPage` / `collectForOutput` (`packages/cli/src/output/window.ts`), and export the envelope schema as a named const used both as the command's `outputSchema` and by its e2e test. `has_more` reports what the walk observed — only a source that ran dry may report `false`, and a server count never overrides rows already in hand. `has_more: true` carries a `next_offset` greater than `offset`, or `null` when `--max-bytes` left no room for a single row — an empty window has nowhere to resume from, so it reports the rows that remain and offers no offset to repeat.
- The client is embeddable: no message it produces may name the CLI, an `mb` command, or a CLI flag.

## Tests

- Test code is code: the type rules above apply in full.
- Tests import production schemas from source and never redeclare them, and reuse the client's helpers (`parseJson`, `pollUntil`, `isFileNotFoundError`, `errorMessage`) rather than reimplementing them.
- Assertions are full and exact: `toEqual(<full object>)` over field-by-field `toBe`; exact exit codes (`toBe(2)`, never `.not.toBe(0)`); exact error strings (`toContain("…")` / `toBe("…")`, never `toMatch(/…/i)`). When asserting an error, assert the type AND the exact message slice.
- One concept per test. No tautologies, no tests that re-encode the implementation, no fixture values used by zero assertions. Never `expect(Schema.parse(fixture)).toEqual(fixture)` — schema correctness is proven in e2e against live output.
- `vi.mock` is a last resort. Acceptable only to isolate a side-effecting dep that pollutes the host (e.g. the OS keyring) or to inject a fixture into a fully-exercised pipeline. Never to make a one-line wrapper "testable in isolation".
- Layering rules apply to production source only; `*.test.ts` may import across layers.

| Tier   | Glob                          | Network       | When                |
| ------ | ----------------------------- | ------------- | ------------------- |
| `unit` | `packages/*/src/**/*.test.ts` | none          | every source change |
| `e2e`  | `tests/e2e/**/*.e2e.test.ts`  | live Metabase | every new command   |

E2E invariants — the full contract is in `.claude/skills/add-e2e-test`:

- `runCli` is the only way to invoke the CLI. Never call `execa` / `child_process`, never `fetch` Metabase directly.
- Never hard-code an entity id or an API key. Read ids from `SEEDED`, credentials via `readBootstrap()`.
- State does not persist between tests — each opens on the restored snapshot. Capturing a snapshot is the bootstrap's alone.
- A gated suite passes a `lane` label to `requireServer(lane, {...})` / `requireOAuthServer(lane)`, so a skipped lane is reported rather than counted as passing.
- Never read or print the EE license token (`MB_PREMIUM_EMBEDDING_TOKEN`). To check whether a token-gated lane runs, test the env var for `undefined` — never its value.

## Gate

`bun install` (npm is too old). The whole gate is `bun run check` — `tsc --noEmit`, `oxlint`, `oxfmt --check`, `bun run test`, `lint:skills`, in that order, stopping at the first failure. `bun run check:fix` applies the fixing variants.

Nothing is done until `bun run check` passes. A change touching a command's behaviour isn't done until its e2e lane passes too (`bun run build && bun run e2e:up && bun run e2e:bootstrap`, then `bun run test:e2e`).

Never name the gate after an npm lifecycle hook (`prepare`, `postinstall`) — bun runs those during `bun install`.
