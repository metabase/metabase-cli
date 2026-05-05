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

## Subagent 1 — Layering & import direction

> Audit `src/` in the current repository for layering violations. Use ripgrep / file reads — read-only, no edits.
>
> Skip `*.test.ts` files entirely — per CLAUDE.md, "Layering & boundary rules in `tests/structure.test.ts` apply to production source only; `*.test.ts` files are exempt and may import across layers." Audit only production `.ts` files.
>
> Direction rule: `commands → core → domain`. Specifically:
>
> - `src/domain/**` may import only from `zod` and other `src/domain/**` files. Nothing from `src/commands/`, `src/core/`, `src/runtime/`, `src/output/`.
> - `src/core/**` may import from `src/domain/**`, `src/runtime/**`, and other `src/core/**`. Never from `src/commands/`.
> - `src/output/**` may import from `src/domain/**`, `src/runtime/**`, and `src/core/**` except `src/core/auth/`. Never from `src/commands/` or `src/core/auth/`.
> - `src/runtime/**` may import from `src/core/errors` (typed errors are the project's pattern: `runtime/json.ts` returns `ConfigError`/`ValidationError`, `runtime/poll.ts` throws `TimeoutError`, etc.) and from `src/core/http/client.ts` for the `Client` type only. It must not import from `src/commands/`, `src/domain/`, `src/output/`, or any other `src/core/` file.
> - `src/commands/**` may import from any other `src/` location.
>
> For every violation, report `path:line: <import-stmt> — violates <rule>`. If zero violations, output the single line `(clean)`.

---

## Subagent 2 — Type strictness

> Audit `src/` and `tests/` in the current repository for type-strictness violations. Read-only.
>
> Patterns to find:
>
> - `as <Type>`, `as unknown as`, `as never`, `as any` (any cast form).
> - `: any` or `<any>` annotations.
> - `Record<string, unknown>` used as a typed value (allowed only in structurally-untyped envelopes — flag every instance and let aggregator decide).
> - `!` non-null assertions: `\.\.\.?!\.`, `\.\.\.?!\[`, `! ;`.
> - `// @ts-ignore`, `// @ts-nocheck`, `// @ts-expect-error` (allowed only when paired with `// reason:` and `// FIXME(date)`).
>
> For each, report `path:line: <pattern>: <snippet>`. If zero violations, output `(clean)`.

---

## Subagent 3 — Boundary & process discipline

> Audit `src/` in the current repository for boundary violations. Read-only. Skip `*.test.ts` files entirely (production source only — tests are exempt).
>
> Forbidden outside their permitted homes:
>
> | Pattern                                                                                        | Allowed only in                                 |
> | ---------------------------------------------------------------------------------------------- | ----------------------------------------------- |
> | `process.exit(`                                                                                | `src/cli.ts`                                    |
> | `process.stdout.write`, `process.stderr.write`                                                 | `src/cli.ts`, `src/output/**`                   |
> | `console.{log,warn,error,info,debug}`                                                          | `src/cli.ts`, `src/output/**`                   |
> | `JSON.parse(`                                                                                  | `src/runtime/json.ts`                           |
> | bare `fetch(`, `globalThis.fetch`, third-party HTTP libs (`got`/`axios`/`node-fetch`/`undici`) | `src/core/http/**`                              |
> | `new URL(`                                                                                     | `src/core/http/**`, `src/core/url.ts`           |
> | `child_process` (`spawn`, `exec`, etc.)                                                        | `src/runtime/process.ts`                        |
> | `setTimeout` inside an `await` polling loop                                                    | `src/runtime/poll.ts`, `src/core/http/retry.ts` |
>
> For each violation, report `path:line: <rule>: <snippet>`. If zero violations, output `(clean)`.

---

## Subagent 4 — Test parity

> Audit pairing between `src/` and `tests/` in the current repository. Read-only.
>
> Test layout: this project uses two tiers — colocated unit tests at `src/**/*.test.ts` and end-to-end at `tests/e2e/<noun>.e2e.test.ts`. There are no `tests/integration/` or `tests/smoke/` directories.
>
> Required pairings:
>
> - For every leaf command at `src/commands/<noun>/<verb>.ts`: a `tests/e2e/<noun>.e2e.test.ts` exists and exercises that subcommand via `runCli`. Adding a new command without an e2e test is a missing pairing.
> - For every leaf command at `src/commands/<noun>/<verb>.ts`: the literal `commandPaths` list in `tests/e2e/manifest.e2e.test.ts` must include `"<noun> <verb>"`.
> - For every `src/domain/<r>.ts`: **no** fixture-and-parse-test pair is required (a unit test of the form `Schema.parse(fixture).toEqual(fixture)` is a tautology). The schema's contract is tested by the e2e tier when a command consuming it runs against the live API. Report a missing pairing only if no command consumes the schema AND no e2e test parses through it.
> - For every pure helper file in `src/core/**`, `src/output/**`, `src/runtime/**` (excluding `index.ts` re-exports and types-only files): a colocated unit test (`<name>.test.ts` next to `<name>.ts`) exercises it.
> - For every helper with infinite input space (URL parsing, JSON parsing, projection, byte capping, polling): a property test using `fast-check` should exist.
>
> For each missing pairing, report `<src-path> → expected <test-path>`. If all pairings are present, output `(clean)`.

---

## Subagent 5 — Domain schema contract & dead exports

> Audit `src/domain/` and the export graph in the current repository. Read-only.
>
> **Domain contract** — for every `src/domain/<r>.ts`, verify it exports all of:
>
> 1. `<Resource>` — a `z.object({...}).loose()` for the full API shape, with type via `z.infer`. (Zod 4 — `.passthrough()` is deprecated; `.loose()` is the project standard.)
> 2. `<Resource>Compact` — `<Resource>.pick({...}).strip()` with inferred type. The trailing `.strip()` is **mandatory**: `.pick()` on a `.loose()` parent inherits the loose catchall and silently leaks every API field through the projection at parse time. Report a Compact missing `.strip()` as `path:line: compact-missing-strip: <name>`.
> 3. `<resource>View` — an object with `compactPick: <Resource>Compact` and `tableColumns: ColumnDef[]`.
>
> Report missing exports as `path: missing-export: <Name>`.
>
> **Dead exports** — find any `export` in `src/` that is not imported anywhere in `src/` or `tests/` (excluding `src/cli.ts` and `src/main.ts`, which are entry points). Report as `path:line: dead export: <name>`.
>
> If both checks are clean, output `(clean)`.

---

## Subagent 6 — Code smells (correctness & readability)

> Audit `src/` in the current repository for correctness and readability smells. Read-only.
>
> Find:
>
> - **Silent error swallows.** Empty `catch {}` blocks. `try`/`catch` whose handler returns a default value (`{}`, `[]`, `""`, `null`) instead of rethrowing or returning a typed error.
> - **Placeholder fallbacks for absent state.** `?? ""`, `?? 0`, `?? []`, `?? {}` used to satisfy a type when the real semantic is "missing" or "error" rather than a genuine default. Inspect the surrounding context to judge — a literal default that's user-visible is fine; a coercion that hides a missing API field is not.
> - **Boundary parsing without validation.** `JSON.parse(...)` whose result is consumed without a Zod schema or type guard. Network responses, file contents, env vars treated as already-typed.
> - **Magic literals duplicated across files.** Numeric or string constants (timeouts, byte caps, exit codes, profile/account names, file modes like `0o600`, retry counts) appearing in 2+ files without a shared named constant. Run a ripgrep pass over likely culprits and report any literal with 2+ occurrences in distinct files.
> - **Boolean trap signatures.** Functions with 2+ boolean parameters; call sites passing 2+ positional booleans (`foo(true, false)`) where the call is not self-documenting.
> - **Type guards that don't validate the narrowing.** `function isFoo(value): value is Foo` whose body checks a property weaker than what distinguishes `Foo` (e.g., narrowing to `NodeJS.ErrnoException` on the basis of `instanceof Error` alone). Quote the guard body.
> - **Unreachable branches.** Code paths that cannot fire because an earlier branch returns first, or guards on conditions ruled out at the boundary.
>
> For each, report `path:line: <category>: <snippet>`. If zero findings, output `(clean)`.

---

## Subagent 7 — Comment & file-size hygiene

> Audit `src/` in the current repository for comment and size hygiene. Read-only.
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
> wc -l $(rg -l 'runMain|createServer|setupRoutes|defineCommand|fetch\(' src/ 2>/dev/null) 2>/dev/null | sort -nr | head -15
> ```
>
> Then enumerate the project's own boundary helpers (parsers, HTTP clients, polling, command runtimes) and grep for direct calls to what each helper wraps.
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
- Do not run `npm run check` here.
- An axis with zero findings is listed in the Summary's `Clean axes` line — never silently omitted.
- If a subagent cannot determine something, surface the uncertainty in its findings — never PASS by default.
- No editorializing. Quote snippets; let severity speak.
