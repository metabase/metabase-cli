# CLAUDE.md

Metabase CLI. TypeScript ESM. citty + native `fetch` + Zod + @clack/prompts. oxlint + oxfmt. vitest. tsdown.

## Hard rules

- No `as` type casts: `as X`, `as unknown as X`, `as never`, `as any`. Use type guards in `core/errors.ts`, or Zod `.parse` at boundaries. `as const` is allowed (it's a const assertion, not a cast — it narrows literal types without bypassing checking).
- No `any`. No `Record<string, unknown>` for API responses — every cross-network value gets a named Zod schema in `src/domain/` and is parsed at the boundary. The sole exemption is `src/output/projection.ts`, the canonical structurally-untyped envelope for dot-path `--fields a,b.c.d` projection over already-validated payloads.
- No `!` non-null assertions. Restructure with helpers (see `core/config.ts` `pickField()` for the pattern).
- No inline object types in unions, returns, or function params. Always named via `interface` or `type`.
- No file extensions in imports (`./foo`, not `./foo.ts`). `import type` for type-only imports.
- No comments unless WHY is non-obvious. Never WHAT, never task/PR/path refs.
- Derive types from values when possible: `typeof X`, mapped types over `keyof typeof X`, or library generics (e.g. citty's `ParsedArgs<typeof cmd.args>`). A hand-written interface that mirrors a value's shape will drift silently — derive it.
- When a new helper subsumes an older narrower one, delete the older one in the same change. Don't leave both.
- Fail fast at boundaries. JSON parsing, file reads, HTTP responses must throw or return a typed error on malformed input — never coerce silently to `{}`/`[]`/`""` and continue. Empty `catch {}` is forbidden. Either handle the specific error or let it propagate; corruption that disappears is worse than corruption that crashes.
- No placeholder fallbacks for absent state. `?? ""` / `?? 0` / `?? []` / `?? {}` used to satisfy a type when the real semantic is "missing" or "error" hides bugs. Model absence with `null` or a discriminated union; if the value is required, require it.
- No magic literals. Numeric or string constants that recur (byte caps, timeouts, exit codes, profile names, file modes, account names) get named constants colocated with the canonical user. The same `process.exit(130)` in five files is five places to update.
- No boolean traps. A function with 2+ boolean parameters becomes a named-options object or splits into two functions. `foo(true, false)` at the call site is unreadable and easy to invert.
- Type guards must validate what they narrow. `function isFoo(value): value is Foo` must check the property that distinguishes `Foo`, not a weaker shared property. A guard that narrows on `instanceof Error` while claiming `is NodeJS.ErrnoException` is a hidden cast — callers will read `.code` off something that doesn't have it.
- Eloquence: prefer the simplest realistic expression. Don't stack ceremony — repeated `override readonly` modifiers, generic gymnastics, intermediate abstract classes, or option-bag wrappers — when a plain field, an early return, or a non-generic shape is shorter and clearer. If two real-world engineers wouldn't both reach for the pattern, don't write it. Idiomatic > technically-pristine.
- No big inline expressions. `if (a && b && (c.x?.y ?? 0) > Z || isFooBar(d))` is noise. Split into semantically-named locals (`const hasBudget = …; const isFresh = …; if (hasBudget && isFresh) …`). Same for ternary chains — flatten with early returns, guard clauses, or a small lookup. The conditional in an `if`/return should read as one phrase, not a puzzle.
- We do not duplicate auth resolution for SOURCE/TARGET. Use profiles. Multi-instance commands take `--from-profile` / `--to-profile`, each routed through the same `resolveConfig`. There is no `METABASE_SOURCE_*` env-var family, no parallel `getSourceClient`, no shadow flag set. Inline reads of `process.env.METABASE_URL` / `METABASE_API_KEY` / `METABASE_LICENSE_TOKEN` belong in `core/config.ts` only.
- Tests import production Zod schemas from `src/`; they never redeclare them. `LoginResult` (`src/commands/auth/login.ts`), `AuthStatus` (`src/commands/auth/status.ts`), and every `<Resource>` / `<Resource>Compact` in `src/domain/` is THE contract — copying the shape into a test creates silent drift the type-checker can't catch.
- Tests reuse `src/runtime/` and `src/core/errors` helpers (`parseJson`, `pollUntil`, `isNotFoundError`, `errorMessage`) instead of reimplementing `JSON.parse` + Zod, sleep+deadline loops, or ENOENT shape checks. Tests are code; the layering rules don't bite, but the duplication and drift rules do.

## Layout

- `src/cli.ts` — `runMain` entry.
- `src/main.ts` — root citty command, lazy `subCommands`.
- `src/commands/` — CLI shell only. No HTTP, no parsing, no formatting.
- `src/core/` — pure logic, no CLI deps.
  - `auth/` — storage + verify.
  - `config.ts` — flag → env → stored resolver. Profile-aware (`resolveProfileName`, `resolveConfig`, `resolveLicenseToken`). All `METABASE_*` env-var reads live here.
  - `errors.ts` — `isNotFoundError`, `errorMessage` (Node error type guards used outside the HTTP boundary).
  - `http/` — the HTTP boundary. `client.ts` wraps native `fetch` with `requestParsed(schema, path, opts)` (the ONLY typed-JSON path), `requestRaw`, `requestStream`. Retries are idempotency-aware: GET/HEAD/OPTIONS retry on retryable status codes by default; POST/PUT/PATCH/DELETE never retry on status (only on network/timeout). Callers may override via `RequestOptions.idempotent`. `errors.ts` owns the discriminated `MetabaseError` taxonomy and `toMetabaseError(unknown)`. `sanitize.ts` runs at `HttpError` construction — secret redaction is not optional. `retry.ts` is the backoff math; it is also the only `core/http/` site allowed to drive a `setTimeout`-based wait loop (via `node:timers/promises`) outside `src/runtime/poll.ts`. Nothing outside this directory may import a third-party HTTP library or call `fetch` directly; this is enforced by `tests/structure.test.ts`.
  - `url.ts` — `normalizeUrl` and `originOnly`. The single permitted home for `new URL(...)` outside `src/core/http/**`; the URL helpers belong here, not at call sites.
- `src/domain/` — one file per Metabase resource; Zod schema + inferred type co-located. See **Domain pattern**.
- `src/output/` — presentation; takes typed values.
- `src/runtime/` — platform glue (stdin, poll).
  - `input.ts` — `readInput({ flag, file, stdin, positional, required })` resolves a body-shaped input. Precedence: `flag > file > stdin > positional`; first non-empty source wins. Stdin reads when `stdin: true` or when `process.stdin.isTTY` is false (auto-detect for pipes). `required: true` (default) throws `ConfigError` when every source is empty. Stdin reading lives only here.
  - `body.ts` — `readBody(sources, schema)` chains `readInput` + `parseJson` + Zod validation for JSON bodies. Rejects multiple explicit body sources (`--body` + `--file` + `--stdin` + positional) with `ConfigError`; only one wins.
  - `paginate.ts` — `paginate(client, path, itemSchema, opts)` is the canonical limit/offset iterator over Metabase list endpoints; returns `AsyncIterable<T>`. Honors `commonFlags.limit` via `opts.max`; defaults pageSize to 50 (Metabase server default). `collectPaginated` drains it into an array.
- `tests/` — see **Tests** and **E2E test tier**. Unit tests sit beside source under `src/**/*.test.ts`. The e2e tier lives under `tests/e2e/` with its own runtime contract.
- `bin/metabase-dev` — contributor wrapper running the CLI from source against an isolated `XDG_CONFIG_HOME=$ROOT/.dev-state` with `METABASE_CLI_DISABLE_KEYRING=1`. Use this — never the real `~/.config` — when poking at the running e2e Metabase by hand.

## Commands runtime

- `src/commands/runtime.ts` — `defineMetabaseCommand({ meta, args, run })` is the canonical command shell. It merges `commonFlags` into `args` (callers add only their extra flags), parses `args` through `resolveCommonFlags` to build `ctx`, and exposes a lazy `getClient()` that runs `resolveConfig` + `createClient` on first call (cached). Use it instead of `defineCommand` directly. Pass `args: {}` when a command adds no extra flags.
- `src/output/prompt.ts` — `promptText` / `promptPassword` / `promptConfirm` / `promptSelect` wrap `@clack/prompts`. They throw `AbortError` on user cancel and `ConfigError` when stdin is not a TTY. Commands import these instead of `@clack/prompts` directly so the cancel-to-`AbortError` pathway is funneled in one place.

## Domain pattern

Every Metabase API resource lives in `src/domain/<resource-singular>.ts` (`card.ts`, `dashboard.ts`, `database.ts`, …) and exports exactly three things per resource:

1. **`<Resource>`** — `z.object({ ... }).loose()` for the full API shape; type aliased via `export type <Resource> = z.infer<typeof <Resource>>`. `.loose()` is the default so Metabase API additions don't break us; tighten over time. (Zod 4 — `.passthrough()` is deprecated.)
2. **`<Resource>Compact`** — `<Resource>.pick({ ... })` projection for list output and agent-facing JSON; type aliased the same way. The compact view is the agent-facing contract.
3. **`<resource>View`** — `ResourceView<T>` with `compactPick: <Resource>Compact` and `tableColumns: ColumnDef<T>[]`. Consumed by `src/output/render`; never inline a column list in a command.

Naming: `<Resource>` is PascalCase (`Card`, `CurrentUser`); `<Resource>Compact` follows; `<resource>View` is camelCase (`cardView`, `userView`). The token `<Resource>` is the resource name, not the file name — a single file may host multiple resources (e.g. `domain/user.ts` exports `CurrentUser`/`CurrentUserCompact`/`userView`), and the three-export contract holds per-resource.

Adding a resource is purely additive: drop in `src/domain/<r>.ts`, add `tests/fixtures/<r>/sample.json`, add a unit test that runs `<R>.parse(<fixture>)` and asserts the parsed value. Never edit an existing command to wire schemas — commands import what they need.

Forbidden in commands: typing a response as `Array<Record<string, unknown>>`, `any`, or any inline `as { ... }` shape cast on a nested API field. The Zod schema is the single source of truth; downstream code consumes `z.infer<typeof Schema>`.

## Tests

- Test code is code. Same hard rules apply: no `as`, no `any`, no `!`, no `Record<string, unknown>`, no inline types, no WHAT-comments, named types for fixtures.
- Layering & boundary rules in `tests/structure.test.ts` apply to production source only; `*.test.ts` files are exempt and may import across layers to construct realistic inputs (e.g. `output/help.test.ts` importing `defineMetabaseCommand` from `commands/runtime`).
- Tests must verify real behavior. No tautologies. No tests that re-encode the implementation. No tests that pass regardless of the system under test.
- Assertions must be full. Prefer `toEqual(<full object>)` / `toEqual(<full array>)` over poking individual properties. If you assert deep equality of a structure, that single assertion subsumes shape, length, and contents — don't add a separate length or property check before or after it.
- One concept per test. Don't bundle unrelated assertions. Don't add belt-and-suspenders assertions that overlap.
- No fixtures or mocks beyond what the test exercises. Fixture values used by zero assertions are noise — drop them or use a real value.
- When asserting an error, assert the error type AND a meaningful slice of the message — not just "throws".
- `vi.mock(...)` is a last resort, not a default. Module mocks substitute the implementation under test for one you wrote in the test file — the assertion collapses to "the mock returned what I configured." Prefer real values flowing through real imports: construct a real `ZodError` / `Error` / `HttpError` and pass it; build a real Zod schema and `.parse` against it. If a branch only fires on a third-party private symbol or live process state, do not unit-test the branch — cover it in the smoke/integration tier where the real path runs end-to-end. Acceptable uses of `vi.mock`: (a) hermetic isolation of side-effecting deps in integration tests where the real thing pollutes the host (e.g. `@napi-rs/keyring` writing to the real OS keychain), (b) test fixtures injected into a fully-exercised pipeline. Not acceptable: mocking a one-line wrapper to make it "testable in isolation" — that is a tautology dressed as a test.

## Test tiers

| Tier   | Glob                         | Wall-clock      | Network       | When to add         |
| ------ | ---------------------------- | --------------- | ------------- | ------------------- |
| `unit` | `src/**/*.test.ts`           | <1 s/file       | none          | every `src/` change |
| `e2e`  | `tests/e2e/**/*.e2e.test.ts` | seconds–minutes | live Metabase | every new command   |

Local prerequisites for e2e: `bun run e2e:up && bun run e2e:bootstrap` (~1 minute, run once a day). Then `bun run test:e2e` per iteration. `bun run e2e:down` wipes volumes.

## E2E test tier

Lives under `tests/e2e/`. The whole point is to run the **built `dist/cli.mjs`** against a real Metabase via docker compose, with no mocks.

- `tests/e2e/run-cli.ts` — `runCli({ args, configHome, env, stdin, timeoutMs })` is the ONLY way an e2e test invokes the CLI. It spawns `node dist/cli.mjs` via `execa`, with an isolated `XDG_CONFIG_HOME` (per-call temp dir by default), `METABASE_CLI_DISABLE_KEYRING=1`, and stripped env (no inherited `METABASE_*` from the developer's shell). Tests never call `execa`/`child_process` directly; never call `fetch` against Metabase (that's bootstrap's job).
- `tests/e2e/bootstrap-data.ts` — sole owner of the `Bootstrap` Zod schema and `BOOTSTRAP_FILE_PATH` constant. The writer (`tests/e2e/setup/bootstrap.ts`) imports this schema; do not redeclare it. Tests read admin creds via `readBootstrap()` — never invoke the setup wizard themselves, never hard-code an API key.
- `tests/e2e/setup/bootstrap.ts` — standalone script invoked by `bun run e2e:bootstrap` and by `tests/e2e/setup/global-setup.ts`. Idempotent: reuses `.bootstrap.json` when the stored key still authenticates, otherwise calls `/api/setup` (or logs in directly if already setup) and mints a fresh admin API key. The Metabase HTTP responses it parses are setup-only — their schemas live colocated here, not in `src/domain/`.
- `tests/e2e/setup/global-setup.ts` — vitest globalSetup. Verifies `dist/cli.mjs` exists, then spawns `bootstrap.ts` once per `bun run test:e2e`.
- `tests/e2e/defaults.ts` — sole owner of `DEFAULT_E2E_BASE_URL` and `resolveE2EBaseUrl()` (reads `METABASE_CLI_E2E_URL` env override, falls back to the docker-compose default). Anywhere that needs a base URL imports from here.
- `tests/e2e/docker-compose.yml` — Postgres warehouse + Metabase EE (image overridable via `METABASE_E2E_IMAGE`). Token override via `MB_PREMIUM_EMBEDDING_TOKEN` env passes through; absence is fine — EE boots without a token, the test endpoints work either way.

Adding a new e2e test for command `metabase <noun> <verb>`:

1. `tests/e2e/<noun>.e2e.test.ts` — drive the command via `runCli`, assert exit code, assert `--json` output through the schema imported from `src/commands/<noun>/<verb>.ts` or `src/domain/<noun>.ts`. Each test gets its own config home via `mkTempConfigHome()` (or a small `makeIsolatedConfigHome` closure inside the file that pushes onto a `tempDirs` array drained in `afterEach`).
2. The seeded admin API key (`bootstrap.adminApiKey`) authenticates as a synthetic api-key user (`api-key-user-…@api-key.invalid`). For tests that need a real admin user, call `auth login` with admin email/password — but expose that need explicitly; don't paper over it.
3. Never mutate snapshot state in tests. Snapshot/restore (`/api/testing/*`) is reserved for the bootstrap script.

Adding a new field to `.bootstrap.json`:

- Update the `Bootstrap` schema in `tests/e2e/bootstrap-data.ts`. The writer in `setup/bootstrap.ts` consumes the same schema for its parameter type — drift is mechanically prevented.

## Don't

- Add a color library or any colored output.
- Reintroduce a catch-all module or bucket directory: `api.ts`, `schemas.ts`, `lib/`, `_shared/`, `_helpers/`, `_utils/`, `common/`, `misc/`. Name files by purpose, not by "where shared things live."
- Add a third-party HTTP library (`axios`, `got`, `node-fetch`, `undici`, etc.). `src/core/http/` is the HTTP boundary; it wraps native `fetch` (Node ≥ 20.6) with our project-specific contract (`requestParsed(schema)`, `HttpError`-with-sanitization-at-construction, idempotency-aware retries, `expectContentType` enforcement). Extend that module instead of importing a library — every off-the-shelf client would need to be wrapped to satisfy our contract anyway, and the wrapping is more code than the current implementation.
- Write a dotenv parser. Use Node's native `--env-file` (Node ≥ 20.6).
- Add deps for one-off helpers — inline.
- Read or print the EE license token. The dev token is supplied to the e2e stack via `MB_PREMIUM_EMBEDDING_TOKEN` (Metabase's own env var name), and the dev token-check URL via `METASTORE_DEV_SERVER_URL` (also Metabase's name; honored only when `MB_RUN_MODE=dev`, which the compose file already sets). Both flow shell → docker compose → JVM and shell → vitest → `runCli({ stdin })`. Never `cat`/`Read` `.env`/`.envrc`/shell rcs that may contain them, never `echo $MB_PREMIUM_EMBEDDING_TOKEN`, never `console.log` or `expect(...).toContain(token)`. To check whether a license test will run, inspect `process.env["MB_PREMIUM_EMBEDDING_TOKEN"] === undefined` — never the value. Use `mb_dev_…` dummy tokens for storage-roundtrip tests; only the EE-integration suite (gated on the token + dev URL being set) ever threads the real value, and only as opaque stdin to the CLI subprocess.

## Commands

Install: `bun install` (npm 7 too old). Typecheck `npx tsc --noEmit`. Lint `npx oxlint`. Format `npx oxfmt` (`--check` to verify). Build `npx tsdown`.

Tests: `bun run test` (unit), `bun run test:e2e` (e2e — requires `bun run build && bun run e2e:up && bun run e2e:bootstrap` first). Iteration: `bun run test:watch` for unit, `bun run test:e2e:watch` for e2e (Metabase stays up, restart not needed between runs). Stack control: `bun run e2e:up`, `bun run e2e:down`, `bun run e2e:logs`.
