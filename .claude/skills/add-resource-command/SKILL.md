---
name: add-resource-command
description: Add a Metabase API resource end-to-end — Zod schema in `src/domain/`, list/get commands in `src/commands/<noun>/`, unit tests where logic warrants them, and a comprehensive e2e suite. Use whenever the user asks to "add a card/dashboard/<noun> command", "wire up `/api/<endpoint>` end-to-end", "add list/get for <noun>", or anything that introduces a new top-level subcommand backed by a previously-untyped Metabase resource. Loading this skill is mandatory before generating any file under `src/domain/`, `src/commands/<noun>/`, or `tests/e2e/<noun>.e2e.test.ts` — the contract is strict and the dependencies between layers are easy to break.
---

# add-resource-command

Authoritative contract for adding a resource end-to-end. The work spans four layers — domain schema, commands, unit tests, e2e suite — plus a mandatory close-out (`/review` then `/simplify`) before the task is done. The order matters: earlier layers feed types into later ones, and deviating from house style at any step produces drift the type-checker can't catch.

This skill subsumes what was previously called "add-domain-resource." Adding a domain file alone is no longer the unit of work — a resource without a command isn't useful, and a command without an e2e test isn't trustworthy.

## Step 0 — Pre-flight (mandatory)

Anchor to the existing house style. **Skip this and you will produce drift the type-checker won't catch.**

1. `ls src/domain/` and read **one** existing resource file end-to-end (e.g. `src/domain/user.ts`).
2. Read `src/domain/view.ts` (the `ColumnDef<T>` / `ResourceView<T>` contract).
3. Read **one** existing list command and **one** existing get command (look under `src/commands/<noun>/`). Note how `<Resource>ListEnvelope`, `outputSchema`, `parseId`, `renderList`, `renderItem`, and `defineMetabaseCommand` compose.
4. Read **one** existing e2e test (`tests/e2e/<noun>.e2e.test.ts`) and the harness (`tests/e2e/run-cli.ts`, `tests/e2e/bootstrap-data.ts`). The `add-e2e-test` skill's runtime contract is binding here — re-read it before writing the e2e file.
5. Read `src/output/types.ts` to confirm `listEnvelopeSchema` and the `ListEnvelope<T>` interface.

## What you must produce

For a typical list/get pair on a new resource:

1. `src/domain/<r>.ts` — the trio (schema + Compact + view). No fixture, no schema-parse unit test.
2. `src/commands/<r>/index.ts` — citty group with subcommands.
3. `src/commands/<r>/list.ts` — exports `<Resource>ListEnvelope`, uses `renderList`.
4. `src/commands/<r>/get.ts` — uses `parseId` for the positional id, uses `renderItem`.
5. (optional) `src/commands/<r>/<verb>.test.ts` — unit test **only where there is non-orchestration logic to test**.
6. `tests/e2e/<r>.e2e.test.ts` — comprehensive e2e suite.
7. Updated `src/main.ts` — register the new top-level subcommand.
8. Updated `tests/e2e/manifest.e2e.test.ts` — add the new leaf paths to the literal `commandPaths` list.

If the resource genuinely has more verbs (e.g. a `<r> values` for fetching distinct values), add them under the same group; the rules below scale per-verb.

## Step 1 — Domain schema (`src/domain/<r>.ts`)

A single file in `src/domain/` may host multiple resources (e.g. `domain/user.ts` exports `CurrentUser` / `CurrentUserCompact` / `userView`). The trio holds **per resource**, not per file. `<Resource>` is PascalCase; `<resource>View` is camelCase.

```ts
import { z } from "zod";
import type { ColumnDef, ResourceView } from "./view";

export const Card = z
  .object({
    id: z.number().int(),
    name: z.string(),
    archived: z.boolean(),
    // ...other API fields with their real Zod types
  })
  .loose();
export type Card = z.infer<typeof Card>;

export const CardCompact = Card.pick({ id: true, name: true, archived: true }).strip();
export type CardCompact = z.infer<typeof CardCompact>;

export const cardView: ResourceView<Card> = {
  compactPick: CardCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "archived", label: "Archived" },
  ],
};
```

Rules:

- `.loose()` is the default — Metabase API additions must not break us. Tighten over time, never on first land. (Zod 4: `.passthrough()` is deprecated; use `.loose()`.)
- **`.strip()` after `.pick()` is mandatory on the Compact**, not optional. `.pick({...})` on a `.loose()` parent inherits the loose catchall, and the picked schema then _passes every API field through unchanged at parse time_ — your "compact" projection silently leaks the full payload into list output and `--detail compact` JSON. The bug is invisible until you eyeball the rendered output. Always end with `.strip()`.
- The compact projection is the **agent-facing contract** — it shows up in list output and `--detail compact` JSON. Pick the smallest set of fields that uniquely identifies + describes the resource for an LLM caller.
- `tableColumns` keys must be valid keys of the **compact** type (the projection drives both JSON and text output).
- Type aliases via `z.infer<typeof X>`. Never hand-write a parallel `interface` — it will drift silently.
- **Optional vs. nullable.** Metabase returns `null` for absent values; it rarely omits the key. Default to `z.<base>().nullable()` and reach for `.optional()` only when you have observed the key actually missing in a real response. Wrong here causes silent parse failures on real payloads.
- **Schema scope is principal-engineer judgment, not "mirror the frontend type."** Pick the fields the agent needs to do its job (write queries, choose content). Drop sync flags, fingerprints, JSON-unfolding metadata, audit timestamps, and other internal plumbing. `.loose()` keeps the door open for fields the agent doesn't need declared. The schema's job is to declare what's required and what's typed — not to recapitulate the API.
- **Pin closed enums** when the backend has one. The frontend often types a field as `string | null` even when the backend enumerates the value via Clojure `(derive :namespace/X :namespace/parent)` hierarchies. Pin the schema to `z.enum([...])` over the closed set: agents get a typed surface, and a server-side addition becomes a hard parse failure (a signal we can act on) rather than a silent string. To find the closed set, check the backend Clojure source — typically `src/metabase/types/core.cljc` or the resource's `api.clj` — for `derive` declarations under the resource's keyword namespace.

Forbidden:

- Typing an API response as `Array<Record<string, unknown>>`, `any`, `unknown`, or an inline `{ ... }` shape cast. The Zod schema is the single source of truth; downstream code consumes `z.infer<typeof Schema>`.
- Editing an existing command to wire the schema in. The domain file is purely additive; the command in Step 2 is the one that consumes it.
- Declaring a separate `interface <Resource> { ... }` next to `const <Resource> = z.object(...)`. Use the inferred type alias.
- Putting the schema anywhere except `src/domain/`. No `src/schemas.ts`, no `src/api.ts`, no `commands/<x>/types.ts`.
- Adding a `tests/fixtures/<r>/sample.json` + colocated parse-test pair. `Schema.parse(fixture).toEqual(fixture)` is a tautology against Zod itself, with zero signal about whether the schema matches a real response. The schema is contract-tested by the e2e tier in Step 4.

## Step 2 — Commands

Each leaf command uses `defineMetabaseCommand`. Three artifacts per resource group:

**`src/commands/<r>/index.ts`** — a tiny citty group:

```ts
import { defineCommand } from "citty";

export default defineCommand({
  meta: { name: "<r>", description: "Inspect Metabase <resource-plural>" },
  subCommands: {
    list: () => import("./list").then((m) => m.default),
    get: () => import("./get").then((m) => m.default),
  },
});
```

Add `alias` to the `meta` if a short or alternate name is helpful (e.g. `db` aliasing `database`).

**`src/commands/<r>/list.ts`** — exports the envelope schema, uses it as `outputSchema`:

```ts
import { z } from "zod";

import { <Resource>, <Resource>Compact, <resource>View } from "../../domain/<r>";
import { renderList } from "../../output/render";
import { listEnvelopeSchema, type ListEnvelope } from "../../output/types";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

const <Resource>ApiList = /* schema for the actual API response shape */;

export const <Resource>ListEnvelope = listEnvelopeSchema(<Resource>Compact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List <resource-plural>" },
  args: { ...outputFlags, ...profileFlag, ...connectionFlags /* + filter flags */ },
  outputSchema: <Resource>ListEnvelope,
  examples: ["metabase <r> list", "metabase <r> list --json"],
  async run({ ctx, getClient }) {
    const client = await getClient();
    const response = await client.requestParsed(<Resource>ApiList, "/api/<r>");
    const envelope: ListEnvelope<<Resource>> = {
      data: /* extract items */,
      returned: /* count */,
      total: /* count or undefined */,
    };
    renderList(envelope, <resource>View, ctx);
  },
});
```

The `<Resource>ListEnvelope` export is **mandatory**. It is consumed by the manifest (via `outputSchema`) and by the matching e2e test (which imports it back to parse `--json` output). Do **not** redeclare a `z.object({ data, returned, total })` shape inline anywhere.

The API response schema (`<Resource>ApiList` above) is the _server's_ envelope shape (often `{ data: [...], total: N }` or a bare array) and is distinct from the _CLI's_ envelope. Keep it private to the file.

**`src/commands/<r>/get.ts`** — positional id parsed via `parseId`:

```ts
import { <Resource>, <resource>View } from "../../domain/<r>";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "get", description: "Get a <r> by id" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "<R> id", required: true },
  },
  outputSchema: <Resource>,
  examples: ["metabase <r> get 1", "metabase <r> get 1 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const item = await client.requestParsed(<Resource>, `/api/<r>/${id}`);
    renderItem(item, <resource>View, ctx);
  },
});
```

**`src/main.ts`** — register the new top-level subcommand alongside the existing entries.

When smoke-testing commands by hand, **never pass an API key on argv** — Metabase keys must come through env (`METABASE_URL`, `METABASE_API_KEY`) or stdin. The runtime hook will block argv-embedded keys.

## Step 3 — Unit tests

Add a `<verb>.test.ts` next to a command **only where there is non-orchestration logic to test**. Examples that warrant a unit test:

- A `--<flag>`-style filter applied client-side after the API returns (test the filter independently of the network round-trip).
- Argument-parsing branches with multiple failure modes (a new parser; `parseId` itself is centralized and already covered).
- A response-shape transformation that maps multiple fields or merges two endpoints' output.
- An error-mapping branch that converts a specific HTTP status to a specific user message.

**Forbidden unit tests** (silent drift, fail-by-tautology):

- `Schema.parse(fixture).toEqual(fixture)` — only proves Zod works.
- `vi.mock('citty')` or `vi.mock('../../core/http/client')` to "test" a command — collapses to "the mock returned what I configured." If the only way to unit-test a branch is to mock a project helper, push the coverage to e2e instead.
- Tests that re-encode the implementation (e.g. asserting the exact arg list passed to `client.requestParsed`).

When in doubt, push coverage to the e2e tier — it runs the real path. A command whose run body is purely "call client, render" has nothing meaningful to assert at the unit tier; that's fine, and you should say so explicitly when filling in the sanity-check list at the bottom.

## Step 4 — E2E tests (comprehensive)

Live under `tests/e2e/<r>.e2e.test.ts`. Drive the **built** `dist/cli.mjs` against the seeded warehouse via `runCli`. Re-read the `add-e2e-test` skill before writing the file — its runtime contract (no `vi.mock`, no `execa`/`spawn`, env hygiene, per-test config home, opaque license tokens, no `/api/testing/*` calls) is binding here.

A comprehensive suite for a typical list/get pair covers, at minimum:

1. **List, default flags** — `exitCode === 0`, parsed via `<Resource>ListEnvelope` (imported from `src/commands/<r>/list.ts`), asserts the seeded items appear with the expected compact fields via a single `toEqual({ ...full envelope... })` when feasible. If the list is unbounded (paginated or non-deterministic order), assert the _shape_ and the _presence_ of stable items rather than the full array, and still spell out the expected items as full objects.
2. **List, a meaningful filter flag** (if the command has one) — `exitCode === 0`, asserts the filter narrowed the result and that every returned item satisfies the filter.
3. **Get, success** — `exitCode === 0`, parsed via `<Resource>` (with `--detail full`) or `<Resource>Compact` (default). Assert the parsed object with one `toEqual({ ... })` over the full expected payload, **never** a sequence of `expect(parsed.id).toBe(...)`/`expect(parsed.name).toBe(...)` field pokes. Use a stable identifier from `tests/e2e/seed/ids.ts` if pinned, otherwise look up the id dynamically by listing first and filtering by a known name.
4. **Get, invalid positional** (`abc`, empty, negative, zero) — `exitCode === 2` (`ConfigError`), `stderr.toContain('invalid id: "<value>" (expected integer)')` (the literal message from `src/commands/parse-id.ts`), stdout empty.
5. **Get, valid format but missing on server** (e.g. `9999999`) — `exitCode === 1` (`HttpError`), `stderr.toContain("Not found.")` (the literal `userMessage` from Metabase's 404 envelope; see `src/core/http/errors.ts` for the taxonomy).

Assertions are exact at every level — these are not stylistic preferences, they are hard rules from CLAUDE.md and the `add-e2e-test` skill:

- **Exit codes** — always the exact integer (`toBe(0)`, `toBe(1)`, `toBe(2)`, `toBe(130)`). Never `.not.toBe(0)`. The `src/core/errors.ts` taxonomy is fixed: `ConfigError`=2, `AbortError`=130, all others=1.
- **Error strings** — always `toContain("<exact substring>")` or `toBe("<exact full string>")`. Never `toMatch(/.../i)`. Look the literal up in `src/` and pin it. A regex with `\d+` or `.*` for a dynamic part is FAIL — build the expected string from the same source the production code consumed and assert with `toBe`.
- **Parsed payloads** — always one full `toEqual({ ... })`. Field-by-field `toBe` after `parseJson` is FAIL.

If the command has additional verbs or flags with branching behavior, add a test per branch.

Schemas are imported, never redeclared:

- Single item: `<Resource>` / `<Resource>Compact` from `src/domain/<r>.ts`.
- List envelope: `<Resource>ListEnvelope` from `src/commands/<r>/list.ts`.

If the command needs auth (the common case), pass `bootstrap.adminApiKey` and `bootstrap.baseUrl` via `runCli({ env: { METABASE_URL, METABASE_API_KEY } })` — never via argv.

## Step 5 — Manifest parity

`tests/e2e/manifest.e2e.test.ts` has a literal `commandPaths` list. Add the new entries (`<r> list`, `<r> get`, …) in the same place new commands appear. Without this update the manifest test fails on a clean run.

## Step 6 — Self-grep before close-out (mandatory)

Run each of these. Any hit must be fixed; then re-run.

```sh
# Domain file:
rg -n "Record<\s*string\s*,\s*unknown\s*>" src/domain/<r>.ts && echo FAIL || echo OK
rg -n "\bas \b[A-Z]" src/domain/<r>.ts && echo FAIL || echo OK
rg -n ":\s*any\b|<any>" src/domain/<r>.ts && echo FAIL || echo OK
rg -n "[\w\)\]]!\." src/domain/<r>.ts && echo FAIL || echo OK
rg -n "@ts-(ignore|nocheck|expect-error)" src/domain/<r>.ts && echo FAIL || echo OK
rg -n "\.pick\(\{[^}]*\}\)\s*;" src/domain/<r>.ts && echo FAIL || echo OK    # `.pick(...)` not followed by `.strip()`

# E2E test:
rg -n 'from\s+"execa"|from\s+"node:child_process"|from\s+"child_process"' tests/e2e/<r>.e2e.test.ts && echo FAIL || echo OK
rg -n "\bspawn\(|\bexec\(|\bexecFile\(" tests/e2e/<r>.e2e.test.ts && echo FAIL || echo OK
rg -n "\bfetch\s*\(" tests/e2e/<r>.e2e.test.ts && echo FAIL || echo OK
rg -n "vi\.(mock|spyOn|hoisted|fn)\b" tests/e2e/<r>.e2e.test.ts && echo FAIL || echo OK
rg -n "JSON\.parse\(" tests/e2e/<r>.e2e.test.ts && echo FAIL || echo OK         # use parseJson
rg -n "z\.object\(\{[^}]*\bdata\b[^}]*\breturned\b" tests/e2e/<r>.e2e.test.ts && echo FAIL || echo OK   # redeclared envelope
rg -n "env:\s*process\.env|\.\.\.process\.env" tests/e2e/<r>.e2e.test.ts && echo FAIL || echo OK
rg -n "\.not\.toBe\(0\)" tests/e2e/<r>.e2e.test.ts && echo FAIL || echo OK   # exact exitCode required
rg -n "\.toMatch\(/" tests/e2e/<r>.e2e.test.ts && echo FAIL || echo OK       # exact substring required
```

## Step 7 — Runnable verification (mandatory, all green before close-out)

```sh
npx tsc --noEmit
bun run test
bun run build
bun run test:e2e tests/e2e/<r>.e2e.test.ts
```

If any step fails: fix and re-run, do not paper over. If you cannot run them in your environment, say so explicitly — do not claim "done."

## Step 8 — Close-out: `/review` then `/simplify` (mandatory, in this order)

Both are mandatory and must run **after** Step 7 is green. Do not skip either.

1. **`/review`** — runs the strict end-of-task review skill against the diff. Any FAIL must be addressed before continuing. Do not argue with findings; fix them, or skip with an explicit one-line rationale. Re-run `/review` until it returns `RESULT: PASS`.

2. **`/simplify`** — runs the reuse / quality / efficiency review. Apply each finding that survives the rubric; skip false positives with a one-line note. Resolve any structural issues `/simplify` surfaces (redeclared schemas, missing manifest entries, magic-literal duplication, etc.) by going back to the relevant earlier step.

If either skill surfaces a structural issue (missing `.strip()`, redeclared list envelope, missing manifest entry, e2e test missing a coverage axis), the work is unfinished — fix and re-run the close-out from `/review`.

## Sanity checks before declaring done

- [ ] Step 0 actually performed (read existing domain file, list command, get command, e2e test, output/types).
- [ ] **Domain trio**: `<Resource>` with `.loose()`, `<Resource>Compact` with `.pick({...}).strip()`, `<resource>View`. No hand-written parallel interface.
- [ ] Closed enums pinned via `z.enum([...])` where the backend defines a closed set.
- [ ] Schema scope is query/agent-relevant fields only — no sync flags, fingerprints, audit timestamps, or other internal plumbing unless they drive an actual decision.
- [ ] No fixture or schema-parse unit test added.
- [ ] **List command** exports `<Resource>ListEnvelope = listEnvelopeSchema(<Resource>Compact)` and uses it as `outputSchema`. The API-response shape is a separate private schema.
- [ ] **Get command** uses `parseId` for the positional integer id.
- [ ] `src/main.ts` registers the new subcommand.
- [ ] Unit test added only where non-orchestration logic exists (or none added, with explicit rationale — "command body is pure orchestration" is acceptable).
- [ ] **E2E test** at `tests/e2e/<r>.e2e.test.ts` covering at minimum: list default, list filtered (if applicable), get success, get invalid id, get missing id.
- [ ] E2E test imports schemas from `src/`; no `z.object({...})` redeclaration of any output shape.
- [ ] `tests/e2e/manifest.e2e.test.ts` `commandPaths` list updated with the new leaves.
- [ ] Self-grep step (Step 6) ran clean.
- [ ] `npx tsc --noEmit`, `bun run test`, `bun run build`, `bun run test:e2e <new-files>` all exited 0.
- [ ] `/review` returned `PASS`.
- [ ] `/simplify` findings either applied or explicitly skipped with a reason.

If any box is unchecked, the task is unfinished — state explicitly which and continue working.
