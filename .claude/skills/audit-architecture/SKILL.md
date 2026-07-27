---
name: audit-architecture
description: Whole-repo architectural drift sweep. Spawns eight parallel read-only subagents, each focused on one axis across the entire codebase (not just the diff). Aggregates findings into a single severity-ranked report. Use periodically, before milestones, or on user /audit-architecture.
---

# audit-architecture

Whole-tree non-deterministic audit. Where `/review` checks the diff, this checks every file in the repository for slow drift accumulated across many small changes.

## When to invoke

- User `/audit-architecture`.
- Scheduled drift sweep (weekly).
- Before milestones / version bumps.
- After large refactors.

## How it runs

1. Determine the repository root from the current working directory: `git rev-parse --show-toplevel` (or use the cwd if not a git repo). All paths in the prompts are repo-relative — every subagent inherits the cwd.
2. Spawn **eight** read-only subagents **in parallel** in a single message (multiple `Agent` tool calls in one block). Each is `subagent_type=Explore`. Each prompt below is self-contained — copy verbatim. Subagents have no conversation context.
3. After all eight return, build the aggregated report (format at the bottom).

---

## Subagent 1 — Layering, import direction & package boundary

> Audit `packages/client/src/` and `packages/cli/src/` in the current repository for layering violations. Use ripgrep / file reads — read-only, no edits.
>
> Skip `*.test.ts` files entirely — per CLAUDE.md, "Layering & boundary rules are declared per package and apply to production source only; `*.test.ts` files are exempt and may import across layers." Audit only production `.ts` files.
>
> This is a bun workspace: `packages/client` (`@metabase/client`) is the private Metabase API client, `packages/cli` (`@metabase/cli`) is the publishable CLI built on it.
>
> **Package boundary (hardest rule):**
>
> - Nothing under `packages/client/src/**` may import from `packages/cli` — not by an `@metabase/cli` specifier, and not by a relative path that resolves outside the client's own src tree (`../../cli/src/...` reads as ordinary navigation but lands in the other package).
> - The client's dependency budget is `zod`, `semver`, and `node:` builtins. Root devDependencies hoist, so any third-party import resolves at runtime — report every production client file importing a package outside that budget.
> - `packages/cli/src/**` consumes the client by specifier: `@metabase/client/<path>` (e.g. `@metabase/client/domain/card`, `@metabase/client/json`, `@metabase/client/errors`). A relative path from the CLI into `packages/client/src/` is a violation.
>
> **Within `packages/client/src/`:**
>
> - `domain/**` may import only from `zod` and other `domain/**` files.
> - `resources/**` — one file per Metabase resource, holding every `/api/` path the client sends — may be imported only by `client.ts` and by sibling `resources/**` files. A `domain/**`, `http/**`, `auth/**`, `version/**` or root-level client file importing a resource is a violation; the direction runs one way, and the permitted importers are an allowlist, so a directory added later is not exempt for having arrived after the rule.
> - Everything else may import freely within the client, subject to the boundary rules above.
>
> **Within `packages/cli/src/`:**
>
> - `commands/**` may import from any other CLI location and any `@metabase/client/*` path. It reaches Metabase only as `client.<resource>.<method>(…)` — a command naming an `/api/…` path literal or calling `requestParsed` / `requestRaw` / `requestStream` / `paginatePages` is a violation. Both rules are absolute and admit no exception, so report every offending file. Report separately any command that reaches the network by another name: `commands/auth/login.ts`'s `tryDiscoverMetadata` is the one sanctioned case, and no pattern rule can see a second one.
> - `core/**` may import from `runtime/**`, other `core/**`, and `@metabase/client/*`. Never from `commands/` or `output/`.
> - `output/**` may import from `runtime/**`, `core/**` except `core/auth/`, and any `@metabase/client` path **except `@metabase/client/http`** and anything beneath it (presentation consumes the error taxonomy from `@metabase/client/errors`, never the HTTP boundary). Never from `commands/`.
> - `runtime/**` may import from `@metabase/client/*` (typed errors are the project's pattern: `runtime/body.ts` uses `parseJson` and `ConfigError`, `runtime/yaml.ts` uses `ValidationError`). It must not import from `commands/`, `core/`, or `output/`.
>
> For every violation, report `path:line: <import-stmt> — violates <rule>`. If zero violations, output the single line `(clean)`.

---

## Subagent 2 — Type strictness

> Audit `packages/client/src/`, `packages/cli/src/`, and `tests/` in the current repository for type-strictness violations. Read-only.
>
> Patterns to find:
>
> - `as <Type>`, `as unknown as`, `as never`, `as any` (any cast form).
> - `: any` or `<any>` annotations.
> - `Record<string, unknown>` used as a typed value (the sole sanctioned home is `packages/cli/src/output/projection.ts` — flag every other instance and let the aggregator decide).
> - `!` non-null assertions: `\.\.\.?!\.`, `\.\.\.?!\[`, `! ;`.
> - `// @ts-ignore`, `// @ts-nocheck`, `// @ts-expect-error` (allowed only when paired with `// reason:` and `// FIXME(date)`).
>
> For each, report `path:line: <pattern>: <snippet>`. If zero violations, output `(clean)`.

---

## Subagent 3 — Boundary & process discipline

> Audit `packages/client/src/` and `packages/cli/src/` in the current repository for boundary violations. Read-only. Skip `*.test.ts` files entirely (production source only — tests are exempt).
>
> The permitted homes are declared **per package** in CLAUDE.md — a pattern's home in one package says nothing about the other. Judge each file against the table for the package it lives in. All paths below are relative to that package's `src/`.
>
> The client — every file under `packages/client/src/`:
>
> | Pattern                                                                                        | Allowed only in                         |
> | ---------------------------------------------------------------------------------------------- | --------------------------------------- |
> | bare `fetch(`, `globalThis.fetch`, third-party HTTP libs (`got`/`axios`/`node-fetch`/`undici`) | `http/**`                               |
> | `new URL(`                                                                                     | `http/**`, `url.ts`                     |
> | `JSON.parse(`                                                                                  | `json.ts`                               |
> | `setTimeout` inside an `await` wait loop                                                       | `poll.ts`, `http/retry.ts`              |
> | `process.stdout.write`, `process.stderr.write`                                                 | nowhere — the client owns no output     |
> | `process.exit(`                                                                                | nowhere — the client never ends the run |
> | `@clack/prompts`, `@clack/core`                                                                | nowhere — prompting is the CLI's job    |
> | `fs`, `fs/promises`, `node:fs`, `node:fs/promises`                                             | nowhere — the client touches no files   |
> | `child_process`, `node:child_process`                                                          | nowhere — the client spawns nothing     |
> | an import specifier ending in `.ts`                                                            | nowhere — imports are extensionless     |
>
> The CLI — every file under `packages/cli/src/`:
>
> | Pattern                                                                | Allowed only in                                                             |
> | ---------------------------------------------------------------------- | --------------------------------------------------------------------------- |
> | `process.exit(`                                                        | `cli.ts`                                                                    |
> | `process.stderr.write`                                                 | `cli.ts`, `output/**`                                                       |
> | `process.stdout.write`                                                 | `output/**`                                                                 |
> | `JSON.parse(`                                                          | nowhere — use `parseJson` from `@metabase/client/json`                      |
> | `new URL(`                                                             | nowhere — use `@metabase/client/url`                                        |
> | bare `fetch(`, `globalThis.fetch`, third-party HTTP libs               | `core/npm-registry.ts`                                                      |
> | `setTimeout` inside an `await` wait loop                               | nowhere — use `pollUntil` from `@metabase/client/poll`                      |
> | `child_process` (`spawn`, `exec`, etc.)                                | `runtime/process.ts`                                                        |
> | `@clack/prompts`, `@clack/core`                                        | `output/prompt.ts`                                                          |
> | `process.env["MB_*"]`, `process.env["METABASE_*"]`                     | `core/env.ts` — a CLAUDE.md rule, not walker-enforced; judge it by reading  |
> | an import specifier ending in `.ts`                                    | nowhere — imports are extensionless                                         |
> | an `/api/…` path literal (`"/api/` or `` `/api/ ``)                    | nowhere under `commands/` — endpoints are the client's `resources/` layer   |
> | `.requestParsed(`, `.requestRaw(`, `.requestStream(`, `paginatePages(` | nowhere under `commands/` — a command calls `client.<resource>.<method>(…)` |
>
> The last two are absolute: neither has a sanctioned home anywhere in the CLI. Report every offending file.
>
> Two rules bind both packages but come from elsewhere, so apply them repo-wide rather than per-package:
>
> - `console.{log,warn,error,info,debug}` — forbidden everywhere, including `output/**` and `tests/`. `.oxlintrc.json` sets `no-console: error` with no overrides. Report every occurrence.
> - Platform env vars (`XDG_CONFIG_HOME`, `APPDATA`, `npm_config_prefix`) are read where they are used — `core/paths.ts`, `core/install-method.ts`, `core/auth/temp-config-home.ts`. `readEnv` owns the `MB_`/`METABASE_` family only; do not report the others.
>
> For each violation, report `path:line: <rule>: <snippet>`. If zero violations, output `(clean)`.

---

## Subagent 4 — Test parity

> Audit pairing between the two packages' source and their tests in the current repository. Read-only.
>
> Test layout: this project uses two tiers — colocated unit tests at `packages/<p>/src/**/*.test.ts` (beside the code, inside the package that owns it) and end-to-end at the repo root under `tests/e2e/<noun>.e2e.test.ts` (workspace-wide, driving the built `packages/cli/dist/cli.mjs`). There are no `tests/integration/` or `tests/smoke/` directories, and neither package has its own e2e tier.
>
> Required pairings:
>
> - For every leaf command at `packages/cli/src/commands/<noun>/<verb>.ts`: a `tests/e2e/<noun>.e2e.test.ts` exists and exercises that subcommand via `runCli`. Adding a new command without an e2e test is a missing pairing.
> - For every leaf command at `packages/cli/src/commands/<noun>/<verb>.ts`: the literal `ALL_COMMANDS` list in `packages/cli/src/runtime/command-help.test.ts` must include `"<noun> <verb>"`.
> - For every `packages/client/src/domain/<r>.ts`: **no** fixture-and-parse-test pair is required (a unit test of the form `Schema.parse(fixture).toEqual(fixture)` is a tautology). The schema's contract is tested by the e2e tier when a command consuming it runs against the live API. Report a missing pairing only if no command consumes the schema AND no e2e test parses through it.
> - For every `packages/client/src/resources/<r>.ts`: a `packages/client/src/resources/<r>.test.ts` beside it, covering every exported method with a wire assertion over `capture.calls` (URL, verb, headers, body) built on `captureFetch` from `packages/client/src/testing/fetch-capture.ts`. Report a method the wire test never sends — nothing else pins its path or query vocabulary at the unit tier.
> - For every pure helper file in `packages/client/src/**` and in `packages/cli/src/{core,output,runtime}/**` (excluding `index.ts` re-exports, the test doubles `packages/client/src/testing/fake-client.ts`, `packages/client/src/testing/fetch-capture.ts` and `packages/cli/src/core/auth/keyring-mock.ts`, and types-only files): a colocated unit test (`<name>.test.ts` next to `<name>.ts`, in the same package) exercises it.
> - For every helper with infinite input space (URL parsing, JSON parsing, projection, byte capping, polling): a property test using `fast-check` should exist.
>
> For each missing pairing, report `<src-path> → expected <test-path>`. If all pairings are present, output `(clean)`.

---

## Subagent 5 — Schema & resource contract, dead exports

> Audit `packages/client/src/domain/`, `packages/client/src/resources/`, and the export graph across both packages in the current repository. Read-only.
>
> **Domain contract** — for every `packages/client/src/domain/<r>.ts`, verify it exports both of:
>
> 1. `<Resource>` — a `z.object({...}).loose()` for the full API shape, with type via `z.infer`. (Zod 4 — `.passthrough()` is deprecated; `.loose()` is the project standard.)
> 2. `<Resource>Compact` — `<Resource>.pick({...}).strip()` with inferred type. The trailing `.strip()` is **mandatory**: `.pick()` on a `.loose()` parent inherits the loose catchall and silently leaks every API field through the projection at parse time. Report a Compact missing `.strip()` as `path:line: compact-missing-strip: <name>`.
>
> Presentation is CLI-owned: the `<resource>View` (`compactPick: <Resource>Compact`, `tableColumns: ColumnDef[]`) belongs in `packages/cli/src/output/views/<r>.ts`. A `ResourceView`, `ColumnDef`, `tableColumns`, or terminal-presentation `format:` helper found under `packages/client/src/domain/` is a layering violation — report as `path:line: presentation-in-client: <name>`.
>
> Report missing exports as `path: missing-export: <Name>`.
>
> **Resource contract** — for every `packages/client/src/resources/<r>.ts`, verify it exports `<r>Resource(transport)`, that `packages/client/src/client.ts` composes the namespace onto the returned object, and that every method follows the eight conventions:
>
> 1. `client.<resource>.<method>(...)`, namespace named after the API resource (`mb.card`, singular). The resource is what Metabase calls the thing, not what it calls the route: the file and the namespace are `snippet` even though the endpoint is `/api/native-query-snippet`, because the domain schema, the CLI noun and the Metabase concept all read `snippet`.
> 2. Path parameters positional, then params, then options: `update(id, params, options?)`.
> 3. Params use Metabase's own field names verbatim — `f`, `model_id`, `include_inactive`. **No mapping layer, no renaming.**
> 4. Transport concerns (`signal`, `timeoutMs`, `retries`) live in the trailing `options`, never in params.
> 5. Wire envelope schemas are module-private to `resources/`; they never appear in `domain/`.
> 6. Methods return domain values, never wire envelopes. Non-paginated lists return `ListResult<T>` = `{ data, total }`.
> 7. A string path parameter always goes through `encodeURIComponent`.
> 8. Every method carries the endpoint's description as a doc comment.
>
> Report as `path:line: <convention-N>: <method-signature-or-path>`. Convention 7 is the one with a silent failure mode, so check every `${…}` in a path template and confirm the interpolated value is either a number or escaped. Report a resource file no line in `client.ts` names as `path: unreachable-namespace: <r>`.
>
> **List windowing** — for every `packages/cli/src/commands/<noun>/list.ts`, verify the envelope comes from one of the three helpers in `packages/cli/src/output/window.ts`, picked by who applied the window: `windowList(data, ctx.range, total)` when the method returned the whole result set as a `ListResult<T>` and the slice is client-side (the common case); `windowServerPage(data, total, ctx.range)` when the endpoint applied `limit`/`offset` itself and reports a count; `collectForOutput(source, view, ctx)` for a genuinely paged endpoint, where `source` is a `PageSource<T>` forwarding the helper's `PageRequest` (`max`, `pageSize`) into the resource's `<thing>Pages` method. An envelope object literal assembled by hand is a drift finding — it produces a plausible shape whose `has_more`/`next_offset` no test catches. Report as `path:line: hand-rolled-envelope: <command>`. Report a source that drops `max` or `pageSize` as `path:line: unbounded-walk: <command>` — the byte budget cannot stop the pull. Also report a list verb that omits `...listFlags`, or that never reads `ctx.range`, as `path:line: unwired-range: <command>` — its `--limit`/`--offset` silently do nothing.
>
> **Dead exports** — find any `export` in either package's `src/` that is not imported anywhere in `packages/*/src/` or `tests/`. Exclude the entry points (`packages/cli/src/cli.ts`, `packages/cli/src/main.ts`) and the client's public barrel `packages/client/src/index.ts`, whose whole job is re-export. A client export consumed only by the CLI (or only by a test) is live, not dead — resolve `@metabase/client/<path>` specifiers to `packages/client/src/<path>.ts` before judging. Report as `path:line: dead export: <name>`.
>
> If both checks are clean, output `(clean)`.

---

## Subagent 6 — Code smells (correctness & readability)

> Audit `packages/client/src/` and `packages/cli/src/` in the current repository for correctness and readability smells. Read-only.
>
> Find:
>
> - **Silent error swallows.** Empty `catch {}` blocks. `try`/`catch` whose handler returns a default value (`{}`, `[]`, `""`, `null`) instead of rethrowing or returning a typed error.
> - **Placeholder fallbacks for absent state.** `?? ""`, `?? 0`, `?? []`, `?? {}` used to satisfy a type when the real semantic is "missing" or "error" rather than a genuine default. Inspect the surrounding context to judge — a literal default that's user-visible is fine; a coercion that hides a missing API field is not.
> - **Boundary parsing without validation.** `JSON.parse(...)` whose result is consumed without a Zod schema or type guard. Network responses, file contents, env vars treated as already-typed.
> - **Magic literals duplicated across files.** Numeric or string constants (timeouts, byte caps, exit codes, profile/account names, file modes like `0o600`, retry counts) appearing in 2+ files without a shared named constant. Run a ripgrep pass over likely culprits and report any literal with 2+ occurrences in distinct files, including pairs that straddle the two packages — a constant duplicated across the boundary belongs to whichever package owns the concept, exported for the other.
> - **Boolean trap signatures.** Functions with 2+ boolean parameters; call sites passing 2+ positional booleans (`foo(true, false)`) where the call is not self-documenting.
> - **Type guards that don't validate the narrowing.** `function isFoo(value): value is Foo` whose body checks a property weaker than what distinguishes `Foo` (e.g., narrowing to `NodeJS.ErrnoException` on the basis of `instanceof Error` alone). Quote the guard body.
> - **Unreachable branches.** Code paths that cannot fire because an earlier branch returns first, or guards on conditions ruled out at the boundary.
>
> For each, report `path:line: <category>: <snippet>`. If zero findings, output `(clean)`.

---

## Subagent 7 — Comment & file-size hygiene

> Audit `packages/client/src/` and `packages/cli/src/` in the current repository for comment and size hygiene. Read-only.
>
> Find:
>
> - Comments that describe **WHAT** the code does instead of WHY. Heuristic: if removing the comment would not confuse a future reader who can read the identifier, it's a WHAT-comment.
> - Comments referencing tasks, PRs, issues, external repo paths, planning documents, dates, or "added/removed/moved by …".
> - Source files larger than 300 lines.
> - Single functions larger than 60 lines (count statements between `{` and matching `}`; ignore comments and blank lines).
>
> For comments report `path:line: <snippet>`. For size report `path: <LOC> lines` and `path:fn-name: <LOC> lines`. If everything is within bounds, output `(clean)`.

---

## Subagent 8 — Code that fights its tools

> Audit the current repository for **complexity that exists because the author didn't use the tools they had**. Read-only. Not a bug hunt — the code probably works. A leverage hunt: places where bespoke machinery does the job of one idiomatic framework / standard-library / project-helper call.
>
> The class of mistake: the author solved a problem from "what I can build" instead of "what is already available." Eight sub-classes:
>
> 1. **Library underuse** — reimplementing something the library exports (custom argv parsing, manual subcommand walking, hand-rolled retry, bespoke debouncing, homegrown error hierarchy that the framework already provides).
> 2. **Library misuse** — wrong primitive from the right library; low-level escape hatch when a high-level helper exists; deep imports (`/dist/`, `/internal/`, `/lib/`); detecting library types by string name instead of via exported guards.
> 3. **Replacing a whole component to alter one seam** — wholesale forks of vendor functions, custom dispatch loops, replacement entry points, when a thin intercept at one of the project's _own_ existing seams would do.
> 4. **Solving at the wrong layer** — fixing the symptom at the boundary instead of asking "where else in our own code does this call path already pass through?" If a wrapper / middleware / factory already covers every call site, the fix belongs there.
> 5. **Standard-library reinvention** — manual byte counting, custom URL parsing, hand-rolled deep-equal, ad-hoc base64, homegrown event emitters when `node:` modules / web platform APIs do it correctly.
> 6. **Defensive over-engineering for impossible states** — try/catch that re-wraps the same error type; validation of trusted internal values; fallback branches that cannot fire; type guards on properties already guaranteed upstream.
> 7. **Project-helper bypass** — direct calls to a primitive when the project owns a wrapper for it. Each direct usage that bypasses the wrapper is drift.
> 8. **Configuration in code** — manual setup that the library accepts as an options bag, plugin, or middleware registration. If the library exposes a hook and the project replaces a function instead, that's almost always the wrong layer.
>
> **Phase 1 — surface candidates** (each hit is a candidate, not a finding):
>
> ```sh
> rg -n "(workaround|HACK|hack-?around|temporarily|until\s+(upstream|merged|fixed)|TODO.*(framework|lib|library|upstream)|FIXME)" --glob '!*.lock' --glob '!*.md'
> rg -n '\.name\s*===\s*"'                                          # detection by string name
> rg -n '\.code\s*===\s*"E[A-Z_]+"'                                 # node-style errno matching
> rg -n 'from\s+"[^"]+/(dist|internal|lib|src)/'                    # deep imports / private API
> rg -n '\b(custom|my|patched|replacement|override|wrapped|reinvented)[A-Z]\w*\s*[=:(]'
> rg -n '^(export\s+)?(async\s+)?function\s+(resolve|walk|find|parse|format|render|dispatch|route|debounce|throttle|retry|backoff|sleep|deepEqual|deepClone|merge|deepMerge|pick|omit|chunk|groupBy|escape)[A-Z]\w*'
> rg -n 'Buffer\.byteLength|Buffer\.from\([^)]*\)\.length|\.split\(""\)\.length'   # manual byte counting
> wc -l $(rg -l 'runMain|createServer|setupRoutes|defineCommand|fetch\(' packages/*/src/ 2>/dev/null) 2>/dev/null | sort -nr | head -15
> ```
>
> Then enumerate the project's own boundary helpers and grep for direct calls to what each helper wraps. Most of them are client surface the CLI is expected to reach for by specifier — `parseJson` (`@metabase/client/json`), `pollUntil` (`@metabase/client/poll`), `paginatePages` (`@metabase/client/paginate`), `normalizeUrl` (`@metabase/client/url`), `errorMessage` / `isFileNotFoundError` (`@metabase/client/errors`) — so a CLI file hand-rolling one of those is the highest-yield finding in this axis. The endpoint seam is the client's own: a command that assembles a request from `requestParsed` (`@metabase/client/http/transport`) or `paginatePages` instead of calling `client.<resource>.<method>(…)` is the same finding one layer up, and the simpler form is a method in `packages/client/src/resources/<r>.ts`. The CLI's own seams are `defineMetabaseCommand` (`commands/runtime.ts`), `defineCommandGroup` (`commands/group.ts`), `readEnv` (`core/env.ts`), `readInput` / `readBody` (`runtime/`), `windowList` / `windowServerPage` / `collectForOutput` (`output/window.ts`), and `renderItem` / `renderList` (`output/render.ts`).
>
> **Phase 2 — investigate** (a candidate must survive all five questions to be promoted):
>
> 1. What is this code's job, in one sentence? If you can't say it, drop the candidate.
> 2. What library / framework / runtime is in play?
> 3. Does that library/runtime expose a documented way to do this directly? **Cite the specific export by name** (`X` from package `Y`). "The library probably has it" is not a finding.
> 4. Does the project's architecture provide a seam here that already wraps every call site? Read importers and their importers — if every call path goes through one chokepoint, the bespoke leaf code is misplaced.
> 5. What is the load-bearing reason the bespoke code exists? If you can articulate one (library genuinely cannot do this; seam doesn't actually cover this case; older version had a constraint), the complexity is justified — drop the candidate.
>
> **Phase 3 — verify** before reporting:
>
> - Read the proposed seam — confirm it actually wraps every call site.
> - Read the cited export — confirm its real signature. If you cite an unexported helper, the finding is dead.
> - Spot-check whether anything else in the codebase already uses the better pattern. If yes, this is an outlier waiting to be aligned.
>
> **Output** — one block per finding:
>
> ```
> path:line — <category> — <one-line summary>
>   What's there: <2–3 sentences, quote one short snippet>
>   Solving: <one sentence>
>   Simpler: <name the specific export, hook, helper, or seam, and where the small change goes>
>   Real, not taste: <one sentence — usually "the library exports X" or "every call path already goes through Y">
>   Delta: <LOC removed minus LOC added — e.g., "−72 / +6">
>   Verified: <what you read — file+line of the export, importers of the seam>
> ```
>
> If zero findings survive Phase 2, output `(clean — surveyed N candidates, none survived investigation)`. State `N`. Padding with hedged candidates is forbidden.
>
> **Forbidden in this audit:**
>
> - Recommendations that aren't 1–10 lines at an existing seam ("rewrite using framework X" is out of scope).
> - Findings without a cited export by exact identifier.
> - Speculation about future framework versions.
> - Conflating "I would have written this differently" with "the toolset offers a one-liner for this."
> - Recommending a project helper that doesn't exist yet — that's a separate proposal.

---

## Aggregation

Once all eight subagents return, produce ONE report:

```
# Architectural Audit — <YYYY-MM-DD>

## Summary
- Total findings: <N>
- Critical: <A>   High: <B>   Medium: <C>   Low: <D>
- Clean axes: <comma-separated list of axes that returned (clean)>

## Findings

### Critical
- <path:line> — <rule violated> — <snippet>
...

### High
- ...

### Medium
- ...

### Low
- ...

## Recommendations
1. <concrete next action, ordered by leverage>
2. ...
```

### Severity rubric

- **Critical** — Type-system bypass (casts, `any`, `Record<string,unknown>` for typed values, `!`, `@ts-*`). Boundary violations (`process.exit`, raw `fetch`, `JSON.parse`, `console.*`) outside permitted homes. Layering inversion. Silent error swallows in boundary code (`catch {}`, parse-and-default). Type guards whose body doesn't validate the narrowing. Replacing a whole vendor primitive when an existing project seam covers every call site. Anything that hides drift from the type-checker or the architecture.
- **High** — Missing test pairings. Domain schemas missing required exports. Dead exports. Placeholder fallbacks (`?? ""` etc.) for absent state. Magic literal duplication across files. Boolean trap signatures. Library underuse / misuse where a documented export does the job in fewer lines (estimated delta ≥ −20 LOC).
- **Medium** — File >300 LOC, function >60 LOC, missing fixtures. Unreachable branches. Smaller library-leverage findings (delta < −20 LOC). Standard-library reinvention.
- **Low** — Comment hygiene, stylistic.

## Rules for the audit itself

- Read-only. Do not modify any files.
- Do not run `tsc`, `oxlint`, `oxfmt`, or the test suites here.
- An axis with zero findings is listed in the Summary's `Clean axes` line — never silently omitted.
- If a subagent cannot determine something, surface the uncertainty in its findings — never PASS by default.
- No editorializing. Quote snippets; let severity speak.
