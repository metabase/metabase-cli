# Architecture

Why the repo is shaped the way it is. The binding rules are in `CLAUDE.md`; this file explains the parts whose rationale is not evident from the code.

## Two packages

A bun workspace. `packages/client` (`@metabase/client`) is the Metabase API client — Zod domain schemas, the HTTP boundary, the OAuth protocol and login flow, the version/capability model. `packages/cli` (`@metabase/cli`) is the publishable CLI built on it.

The CLI consumes the client as `@metabase/client/<path>` and inlines it at build time through tsdown's `noExternal`, so nothing under `dist/` names the private package. That is why the CLI's manifest never lists it as a dependency.

`zod` is a **peer** dependency of the client, not a normal one. The client's public API is Zod schemas, so the consumer's zod instance is part of the contract — shipping our own copy would hand embedders two incompatible `ZodType` identities.

Root devDependencies hoist and are therefore reachable from the client's source tree. The client's dependency budget (`zod` + `semver` + `node:` builtins) is a rule to uphold, not something the resolver rejects.

The split is internal. To anyone outside the repo this is the CLI, which is why the root `README.md` is the CLI's user-facing command reference rather than a workspace map, and why `packages/client/README.md` — the client's own reference — is reached only from inside `packages/`. npm renders a README only from the package root, so `packages/cli/README.md` is a pointer to the root one: install, `mb --help`, and the link. The reference itself has one home.

## Resolution: source, not `dist`

`packages/client`'s `exports` map names built output, and `tsdown` emits one `dist/*.js` + `dist/*.d.ts` pair per entry, deriving its entry list from that map — including by globbing `src/domain/*.ts` and `src/resources/*.ts` for the two wildcards. Adding a file to either directory publishes it automatically.

Nothing in this workspace compiles that output. The root `tsconfig.json`'s `paths` sends `@metabase/client/<path>` to `packages/client/src/<path>` for the type-checker, for bun, and for the rolldown pass behind both tsdown builds; `vitest.workspace.ts` carries the same mapping as a `resolve.alias`.

**A tool that consults neither resolves the export map and reads `dist`, which is stale the moment anyone edits the source.** Give a new tool the mapping when you add it — with `dist` present, a lost mapping fails silently rather than loudly.

## What the exports map costs

Because the entry list is derived by globbing, every filename under `domain/` and `resources/` is a published specifier: renaming a file is a breaking change for consumers, and internal helpers in those directories are public whether or not anyone outside imports them. This is a publish-shape decision, not a cleanup — settle it before `private: true` comes off.

## Process state belongs to the CLI

The client never touches `process`. Signals reach it from its caller: `ClientOptions.signal` is composed into every request alongside per-request signals and the timeout, and the package registers no process signal handler.

TLS trust follows the same split. `trustSystemCa()` merges the OS trust store into Node's default CA list so a Metabase behind a corporate proxy or a local development CA verifies without the user setting `NODE_USE_SYSTEM_CA=1`. It mutates global TLS state, which is a CLI's prerogative and not a library's — hence `node:tls` appears nowhere in `packages/client`. An embedder sees Node's bundled CA list unless it opts into more.

The CLI entry owns the only SIGINT handler. It aborts `interruptSignal` so in-flight work unwinds through the error boundary as an `AbortError` (exit 130), and holds a deadline after which the process ends itself at that code — registering any SIGINT listener removes Node's default terminate-on-Ctrl-C.

## Retries are idempotency-aware

GET/HEAD/OPTIONS retry on retryable status codes, network failures and timeouts, and earn one attempt on a fresh socket when the first try hit a pooled connection the peer had already reaped — even with retries disabled.

POST/PUT/PATCH/DELETE retry on none of it. Metabase offers no idempotency-key framework, so a lost connection cannot prove the write never landed, and a resend would double-create. Callers who know an endpoint tolerates a resend opt back in via `idempotent`.

## Pagination invariants

`paginatePages` is the limit/offset iterator over Metabase list endpoints. It yields `Page<T>` (`{ items, total }`) rather than a bare array so the server's count reaches the caller instead of being spent on loop control.

A walk ends on an empty page, on a server count the rows corroborate, or on the caller's `max`. It does **not** end on a short page, which can equally come from a server-side page cap or a filter applied after the limit; and it does not end on a count the rows in hand already exceed, which is a count the server has disproved.

An endpoint returning the same first row at two different offsets is ignoring `offset`. The walk refuses with a `ConfigError` whether or not a count bounds it: a walk that cannot advance either requests forever or serves the same rows twice, and neither is a listing.

At the CLI layer the same principle governs `has_more`. Over-reporting costs one wasted request; under-reporting strands rows the caller can never ask for again. So a count that contradicts the rows in hand is the count that is wrong, and only a source that ran dry may report `has_more: false`.

Truncation by the output byte cap recomputes `has_more` / `next_offset`, making a capped result a resumption point. An envelope pointing the caller back at the offset it just used would livelock an agent, so a window that returned no rows reports no continuation.

## Capabilities and preflight

The minimum supported server is Metabase v0.58, which is why `{ minVersion: 58 }` is the baseline and is treated as "no gating" — no probe, no enforcement.

The server version and token features are probed once on `auth login` / `auth list` and cached in the profile record. A non-baseline command preflights against that cache and throws `CapabilityError` (exit 2) on a mismatch, or warns and proceeds when the version is unknown. `--skip-preflight` or `MB_CLI_SKIP_PREFLIGHT=1` bypasses it.

To find the right `minVersion` for a new endpoint, validate against `../metabase` at `origin/release-x.58.x` — route files `src/metabase/api_routes/routes.clj` and `enterprise/backend/src/metabase_enterprise/api_routes/routes.clj`. Token-feature keys are the underscored map keys in `src/metabase/premium_features/settings.clj`.

## The e2e stack

The suite drives the built binary against a real Metabase in docker compose, with no mocks. `scripts/e2e-matrix.ts` namespaces the compose project and its volumes per stack, so each matrix entry gets its own server, app-db volume, bootstrap artifact and snapshot. `bun run e2e:up` sets no project name and therefore always targets the default stack's containers, whatever `METABASE_CLI_E2E_STACK` says — reach for `e2e:matrix --stack=<id>` when you need a genuinely separate server.

The bootstrap is idempotent and reuses its artifact while the stored key still authenticates, so iteration cost is test execution rather than setup. It refuses to seed a server that already holds seed content, because seeding twice duplicates every entity. The artifact and snapshot are working-tree state while the app-db is a docker volume, so a fresh worktree or a `git clean -x` puts them out of step; `bun run e2e:down && bun run e2e:up && bun run e2e:bootstrap` is the way back.

A green summary reports the lanes that ran. The closing coverage block reports the ones that did not and why — locally, absent an EE license token, that is every `remote_sync`- and `library`-gated lane. When pasting a run as evidence, paste that block too.

## Generated and vendored files

`packages/cli/src/core/schema/data/` holds the vendored `@metabase/representations` common JSON schemas, written by `scripts/sync-representations.ts` and reaching the CLI only as opaque `import … with { type: "json" }` payloads. The directory is in `.oxfmtrc.json`'s `ignorePatterns`: it is a generated artifact whose writer owns its bytes, and a formatter that reformats it turns every regeneration into a diff the other tool undoes. A generator writing under a formatted tree either emits the formatter's exact output or joins that list.
