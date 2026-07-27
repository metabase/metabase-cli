---
name: add-resource-command
description: Add a Metabase API resource end-to-end — Zod schema in `packages/client/src/domain/`, methods in `packages/client/src/resources/`, list/get commands in `packages/cli/src/commands/<noun>/`, unit tests where logic warrants them, and a comprehensive e2e suite. Use whenever the user asks to "add a card/dashboard/<noun> command", "wire up `/api/<endpoint>` end-to-end", "add list/get for <noun>", or anything that introduces a new top-level subcommand backed by a previously-untyped Metabase resource. Loading this skill is mandatory before generating any file under `packages/client/src/domain/`, `packages/client/src/resources/`, `packages/cli/src/commands/<noun>/`, or `tests/e2e/<noun>.e2e.test.ts` — the contract is strict and the dependencies between layers are easy to break.
---

# add-resource-command

Authoritative contract for adding a resource end-to-end. The work spans five layers — domain schema, resource methods, presentation view, commands, tests — plus a mandatory close-out (`/review` then `/simplify`) before the task is done. The order matters: earlier layers feed types into later ones, and deviating from house style at any step produces drift the type-checker can't catch.

A resource straddles both workspace packages. The schema and the endpoint knowledge are client surface and land in `packages/client/src/domain/` and `packages/client/src/resources/`; the presentation binding and the commands that consume them are CLI surface and land in `packages/cli/`. Adding a domain file alone is not the unit of work — a schema without a method is unreachable, a resource without a command isn't useful, and a command without an e2e test isn't trustworthy.

**The one-line shape of the whole thing:** a command resolves its flags, calls `client.<resource>.<method>(…)`, and renders the result. Every `/api/` path, every query-parameter name, and every call to the HTTP transport lives in `packages/client/src/resources/<r>.ts`.

## Step 0 — Pre-flight (mandatory)

Anchor to the existing house style. **Skip this and you will produce drift the type-checker won't catch.**

1. `ls packages/client/src/domain/` and read **one** existing resource schema file end-to-end (e.g. `packages/client/src/domain/segment.ts`).
2. Read the matching `packages/client/src/resources/segment.ts` and its wire test `packages/client/src/resources/segment.test.ts`, then `packages/client/src/client.ts` for how a namespace is composed onto the client.
3. Read `packages/cli/src/output/view.ts` (the CLI-side `ColumnDef<T>` / `ResourceView<T>` contract) and one existing `packages/cli/src/output/views/<r>.ts` presentation binding.
4. Read **one** existing list command and **one** existing get command (look under `packages/cli/src/commands/<noun>/`). Note how `<Resource>ListEnvelope`, `outputSchema`, `capabilities`, `parseId`, `renderList`, `renderItem`, and `defineMetabaseCommand` compose.
5. Read **one** existing e2e test (`tests/e2e/<noun>.e2e.test.ts`) and the harness (`tests/e2e/run-cli.ts`, `tests/e2e/bootstrap-data.ts`). The `add-e2e-test` skill's runtime contract is binding here — re-read it before writing the e2e file.
6. Read `packages/cli/src/output/types.ts` for `listEnvelopeSchema`, the `ListEnvelope<T>` interface, and `ListRange`; then `packages/cli/src/output/window.ts` for the three window helpers (`windowList`, `windowServerPage`, `collectForOutput`) and the `PageSource<T>` / `PageRequest` contract.

## What you must produce

For a typical list/get pair on a new resource:

1. `packages/client/src/domain/<r>.ts` — the schema pair (`<Resource>` + `<Resource>Compact`). No fixture, no schema-parse unit test.
2. Updated `packages/client/src/index.ts` — re-export every value the domain file exports from the public barrel.
3. `packages/client/src/resources/<r>.ts` — `<r>Resource(transport)`, one method per endpoint.
4. Updated `packages/client/src/client.ts` — compose the namespace onto the client as `<r>: <r>Resource(transport)`.
5. `packages/client/src/resources/<r>.test.ts` — the wire test: one `it` per method, asserting the exact URL, method, headers and body through `captureFetch`.
6. `packages/cli/src/output/views/<r>.ts` — the CLI-side `<resource>View` presentation binding.
7. `packages/cli/src/commands/<r>/index.ts` — citty group with subcommands.
8. `packages/cli/src/commands/<r>/list.ts` — exports `<Resource>ListEnvelope`, uses `renderList`.
9. `packages/cli/src/commands/<r>/get.ts` — uses `parseId` for the positional id, uses `renderItem`.
10. (optional) `packages/cli/src/commands/<r>/<verb>.test.ts` — unit test **only where there is non-orchestration logic to test**.
11. `tests/e2e/<r>.e2e.test.ts` — comprehensive e2e suite.
12. Updated `packages/cli/src/main.ts` — register the new top-level subcommand.
13. Updated `packages/cli/src/runtime/command-help.test.ts` — add the new leaf paths to the literal `ALL_COMMANDS` list.

If the resource genuinely has more verbs (e.g. a `<r> values` for fetching distinct values), add them under the same group; the rules below scale per-verb.

## Step 1 — Domain schema (`packages/client/src/domain/<r>.ts`)

The domain file is client surface, so it lives in `@metabase/client`, not the CLI. Two constraints follow from that:

- **A domain file imports `zod` and sibling `domain/*` files, nothing else.** Not the rest of the client (`../json`, `../poll`), not `node:` builtins, and never `packages/cli` — a client file that reaches into the CLI inverts the dependency between the two packages. The wider `zod` + `semver` + `node:` budget is the client package's ceiling; `domain/` sits well inside it.
- **Nothing CLI-shaped leaks in.** No `@clack/prompts`, no `process.stdout.write`, no `process.exit` — the client never owns presentation or process control.

A single file in `packages/client/src/domain/` may host multiple resources (e.g. `domain/user.ts` exports `CurrentUser` / `CurrentUserCompact`). The pair holds **per resource**, not per file. `<Resource>` is PascalCase.

```ts
import { z } from "zod";

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
```

Rules:

- `.loose()` is the default — Metabase API additions must not break us. Tighten over time, never on first land. (Zod 4: `.passthrough()` is deprecated; use `.loose()`.)
- **`.strip()` after `.pick()` is mandatory on the Compact**, not optional. `.pick({...})` on a `.loose()` parent inherits the loose catchall, and the picked schema then _passes every API field through unchanged at parse time_ — your "compact" projection silently leaks the full payload into list output and default (compact) JSON. The bug is invisible until you eyeball the rendered output. Always end with `.strip()`.
- The compact projection is the **agent-facing contract** — it shows up in list output and default (compact) JSON. Pick the smallest set of fields that uniquely identifies + describes the resource for an LLM caller.
- Type aliases via `z.infer<typeof X>`. Never hand-write a parallel `interface` — it will drift silently.
- **Optional vs. nullable.** Metabase returns `null` for absent values; it rarely omits the key. Default to `z.<base>().nullable()` and reach for `.optional()` only when you have observed the key actually missing in a real response. Wrong here causes silent parse failures on real payloads.
- **Schema scope is principal-engineer judgment, not "mirror the frontend type."** Pick the fields the agent needs to do its job (write queries, choose content). Drop sync flags, fingerprints, JSON-unfolding metadata, audit timestamps, and other internal plumbing. `.loose()` keeps the door open for fields the agent doesn't need declared. The schema's job is to declare what's required and what's typed — not to recapitulate the API.
- **Request-body schemas belong here too.** A create or update verb takes a `<Resource>CreateInput` / `<Resource>UpdateInput` declared alongside the resource, and both the CLI's `readBody` and the resource method's parameter type read it from this one place.
- **Re-export every value the domain file exports from `packages/client/src/index.ts`**, in the alphabetical `./domain/<r>` block. A `domain/` value the barrel does not name is not public client surface — a domain file alone does not make one.
- **Pin closed enums** when the backend has one. The frontend often types a field as `string | null` even when the backend enumerates the value via Clojure `(derive :namespace/X :namespace/parent)` hierarchies. Pin the schema to `z.enum([...])` over the closed set: agents get a typed surface, and a server-side addition becomes a hard parse failure (a signal we can act on) rather than a silent string. To find the closed set, check the backend Clojure source — typically `src/metabase/types/core.cljc` or the resource's `api.clj` — for `derive` declarations under the resource's keyword namespace.

Forbidden:

- Typing an API response as `Array<Record<string, unknown>>`, `any`, `unknown`, or an inline `{ ... }` shape cast. The Zod schema is the single source of truth; downstream code consumes `z.infer<typeof Schema>`.
- Declaring a separate `interface <Resource> { ... }` next to `const <Resource> = z.object(...)`. Use the inferred type alias.
- Putting the schema anywhere except `packages/client/src/domain/`. No `schemas.ts`, no `api.ts`, no `packages/cli/src/commands/<x>/types.ts` — a schema declared CLI-side is invisible to every other consumer of the client.
- Declaring the server's **wire envelope** here. `{ data: [...], total: N }` around a list, or any other shape the transport unwraps and never hands back, is module-private to `resources/` (Step 2). `domain/` holds only what a caller receives.
- Editing an existing command to wire the schema in. Every layer here is purely additive; the command in Step 3 is the one that consumes it.
- Adding a `packages/client/tests/fixtures/<r>/sample.json` + colocated parse-test pair. `Schema.parse(fixture).toEqual(fixture)` is a tautology against Zod itself, with zero signal about whether the schema matches a real response. The schema is contract-tested by the e2e tier in Step 5.

## Step 2 — Resource methods (`packages/client/src/resources/<r>.ts`)

One file per Metabase resource, exporting `<r>Resource(transport)` — a factory returning the object of methods reached as `mb.<r>.<method>(…)`. This is the only layer that names an `/api/` path or calls the transport.

```ts
import { z } from "zod";

import {
  Card,
  type CardCreateInput,
  type CardListFilter,
  type CardUpdateInput,
} from "../domain/card";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";

// `GET /api/card` answers a bare array rather than a `{ data, total }` envelope, so the count a
// caller reads off `ListResult` is the array's own length and the server reports none.
const CardApiList = z.array(Card);

export interface CardListParams {
  f?: CardListFilter | undefined;
  model_id?: string | undefined;
}

export function cardResource(transport: Transport) {
  /** List cards. `f` picks a server-side preset; `model_id` scopes the presets that need an id. */
  async function list(
    params: CardListParams = {},
    options: RequestOptions = {},
  ): Promise<ListResult<Card>> {
    const data = await transport.requestParsed(CardApiList, "/api/card", {
      ...options,
      query: { f: params.f, model_id: params.model_id },
    });
    return { data, total: null };
  }

  /** Get one card by id. */
  async function get(id: number, options: RequestOptions = {}): Promise<Card> {
    return transport.requestParsed(Card, `/api/card/${id}`, { ...options });
  }

  /** Create a card — a question, a model, or a metric — from a full card body. */
  async function create(params: CardCreateInput, options: RequestOptions = {}): Promise<Card> {
    return transport.requestParsed(Card, "/api/card", { ...options, method: "POST", body: params });
  }

  /** Update a card by id, patching only the fields the body carries. */
  async function update(
    id: number,
    params: CardUpdateInput,
    options: RequestOptions = {},
  ): Promise<Card> {
    return transport.requestParsed(Card, `/api/card/${id}`, {
      ...options,
      method: "PUT",
      body: params,
    });
  }

  /** Archive (soft-delete) a card by id. Metabase models this as an update, not its own endpoint. */
  async function archive(id: number, options: RequestOptions = {}): Promise<Card> {
    return update(id, { archived: true }, options);
  }

  return { list, get, create, update, archive };
}
```

The eight conventions every method follows:

1. `client.<resource>.<method>(...)`, namespace named after the API resource (`mb.card`, singular).
   The resource is what Metabase calls the thing, not what it calls the route: the file and the
   namespace are `snippet` even though the endpoint is `/api/native-query-snippet`, because the
   domain schema, the CLI noun and the Metabase concept all read `snippet`.
2. Path parameters positional, then params, then options: `update(id, params, options?)`.
3. Params use Metabase's own field names verbatim — `f`, `model_id`, `include_inactive`. **No mapping
   layer, no renaming.**
4. Transport concerns (`signal`, `timeoutMs`, `retries`) live in the trailing `options`, never in
   params.
5. Wire envelope schemas are module-private to `resources/`; they never appear in `domain/`.
6. Methods return domain values, never wire envelopes. Non-paginated lists return
   `ListResult<T>` = `{ data, total }`.
7. A string path parameter always goes through `encodeURIComponent`.
8. Every method carries the endpoint's description as a doc comment.

Convention 7 has a companion habit: when every path parameter on a resource is a numeric id, say so in a one-line comment at the top of the factory, so a reader knows the omission was decided rather than forgotten.

Further rules:

- **Register the namespace.** `packages/client/src/client.ts` imports the factory and adds `<r>: <r>Resource(transport)` to the returned object, alphabetically. Until that line exists, `client.<r>` does not resolve.
- **Only `client.ts` and `resources/` may import `resources/`.** The direction runs one way; a `domain/` or `http/` file reaching for a resource inverts it.
- **A paged endpoint returns pages.** Where Metabase itself applies `limit`/`offset`, the method returns `AsyncIterable<Page<T>>` from `paginatePages(transport, path, ItemSchema, { query, offset, max, pageSize, signal })` and is named `<thing>Pages`. The caller decides how far to pull.
- **A 204-for-absent endpoint** goes through `fetchOptionalParsed` in `packages/client/src/resources/optional-parsed.ts` rather than a bespoke status check.
- The client never formats, prompts, or exits. A method returns a value or throws from the taxonomy in `packages/client/src/errors.ts`.

**`packages/client/src/resources/<r>.test.ts`** — the wire test, one `it` per method. It builds a real client over `captureFetch` from `@metabase/client/testing/fetch-capture` and asserts the exact request in a single `toEqual`:

```ts
it("sends the get request", async () => {
  const { mb, capture } = clientOver([jsonResponse(SEGMENT)]);

  await mb.segment.get(4);

  expect(capture.calls).toEqual([
    {
      url: "https://mb.example.com/metabase/api/segment/4",
      method: "GET",
      headers: JSON_READ_HEADERS,
      body: null,
    },
  ]);
});
```

This is the test that pins the path, the verb, the query vocabulary and the body serialization — the things a rename would otherwise silently change. `vi.mock` is not how you write it: `captureFetch` scripts real responses through the real transport.

## Step 3 — Presentation and commands

Commands are CLI surface: they live in `packages/cli/src/commands/<r>/` and reach the schema across the package boundary as `@metabase/client/domain/<r>`. Everything CLI-internal (`../../output/render`, `../../output/views/<r>`, `../flags`) stays relative. Each leaf command uses `defineMetabaseCommand`.

**`packages/cli/src/output/views/<r>.ts`** — the presentation binding, one file per domain resource-file, imported by the commands. Presentation is CLI-owned; it never sits on the client surface.

```ts
import { type Card, CardCompact } from "@metabase/client/domain/card";

import type { ResourceView } from "../view";

export const cardView: ResourceView<Card> = {
  compactPick: CardCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "archived", label: "Archived" },
  ],
};
```

- `tableColumns` keys must be valid keys of the resource type; the columns render text/table output while `compactPick` drives compact JSON.
- Any presentation-only cell formatter (a `format:` function that turns a nested value into a table string) lives in this file beside the view — never in the domain schema.

Then the three command artifacts per resource group:

**`packages/cli/src/commands/<r>/index.ts`** — a tiny citty group via `defineCommandGroup`:

```ts
import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "<r>",
  description: "Inspect Metabase <resource-plural>",
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    get: () => import("./get").then((mod) => mod.default),
  },
});
```

Add `alias` if a short or alternate name is helpful (e.g. `db` aliasing `database`), and `skills` to point agents at the skill files that explain the resource's payloads.

**`packages/cli/src/commands/<r>/list.ts`** — exports the envelope schema, uses it as `outputSchema`:

```ts
import { <Resource>Compact } from "@metabase/client/domain/<r>";

import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { <resource>View } from "../../output/views/<r>";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export const <Resource>ListEnvelope = listEnvelopeSchema(<Resource>Compact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List <resource-plural>" },
  capabilities: { minVersion: 58 },
  args: { ...outputFlags, ...listFlags, ...profileFlag, ...connectionFlags /* + filter flags */ },
  outputSchema: <Resource>ListEnvelope,
  examples: ["mb <r> list", "mb <r> list --json"],
  async run({ ctx, getClient }) {
    const client = await getClient();
    const { data, total } = await client.<r>.list();
    renderList(windowList(data, ctx.range, total), <resource>View, ctx);
  },
});
```

`...listFlags` is mandatory on every list verb: it contributes `--limit` / `--offset`, which the command shell resolves into the `ctx.range` that the window helper consumes. Omit it and `ctx.range` is the full range, so the flags an agent needs to page silently do nothing.

**The command names no endpoint.** Two absolute rules govern `packages/cli/src/commands/**` — a command must not name an API path (any `"/api/` or `` `/api/ `` literal) and must not drive the HTTP transport directly (`requestParsed` / `requestRaw` / `requestStream` / `paginatePages`). Neither admits an exception. A new command that builds its own request breaks both, and the fix is always the same — the request belongs in Step 2.

**Pick the window helper by who applied the window** — one of the three in `packages/cli/src/output/window.ts`. Never hand-roll the envelope object; picking wrong produces a plausible envelope that no test catches.

| Helper                                     | Use when                                                                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `windowList(data, ctx.range, total)`       | The method returned the whole result set as a `ListResult<T>` and the slice is client-side. The common case — forward the `total` it reports as it stands.   |
| `windowServerPage(data, total, ctx.range)` | The endpoint applied `limit`/`offset` itself, so `data` is already the slice and `total` is the server's count (see `search.ts`).                            |
| `collectForOutput(source, view, ctx)`      | A genuinely paged endpoint, where `source` is a `PageSource<T>` forwarding the helper's `PageRequest` into the resource's `<thing>Pages` method (see below). |

```ts
const envelope = await collectForOutput(
  (request) =>
    client.collection.itemPages(ref, params, {
      offset: ctx.range.offset,
      ...(request.max !== undefined && { max: request.max }),
      ...(request.pageSize !== undefined && { pageSize: request.pageSize }),
    }),
  collectionItemView,
  ctx,
);
renderList(envelope, collectionItemView, ctx);
```

`collectForOutput` pulls only as far as the output byte budget can display, so an unbounded listing over a large collection costs a page or two rather than a full drain the cap then discards. It sizes each request through the `PageRequest` it hands the source — forward `max` and `pageSize` verbatim, or the budget cannot bound the walk.

Every command declares `capabilities`: `{ minVersion: 58 }` is the supported baseline (no probe, no enforcement), a higher `minVersion` or a `tokenFeature` gates the command behind the preflight check, and `null` marks a command that never touches a Metabase server. Validate the right `minVersion` against the Metabase route files before picking one.

The `<Resource>ListEnvelope` export is **mandatory**. It is consumed by JSON help (`--help --json`, via `outputSchema`) and by the matching e2e test (which imports it back to parse `--json` output). Do **not** redeclare the envelope shape inline anywhere. It is the _CLI's_ envelope — `{ data, returned, offset, limit?, total?, has_more, next_offset?, truncated? }`, declared in `packages/cli/src/output/types.ts` — and has nothing to do with the server's wire envelope, which stayed module-private in Step 2.

**`packages/cli/src/commands/<r>/get.ts`** — positional id parsed via `parseId`:

```ts
import { <Resource> } from "@metabase/client/domain/<r>";

import { renderItem } from "../../output/render";
import { <resource>View } from "../../output/views/<r>";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "get", description: "Get a <r> by id" },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "<R> id", required: true },
  },
  outputSchema: <Resource>,
  examples: ["mb <r> get 1", "mb <r> get 1 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const item = await client.<r>.get(id);
    renderItem(item, <resource>View, ctx);
  },
});
```

**`packages/cli/src/main.ts`** — register the new top-level subcommand alongside the existing entries.

When smoke-testing commands by hand, **never pass an API key on argv** — Metabase keys must come through env (`MB_URL`, `MB_API_KEY`) or stdin. The runtime hook will block argv-embedded keys.

## Step 4 — Unit tests

The resource wire test from Step 2 is not optional; everything in this step is on top of it.

Add a `<verb>.test.ts` next to a command **only where there is non-orchestration logic to test**. Examples that warrant a unit test:

- A `--<flag>`-style filter the CLI applies locally after the client call returns (test the filter independently of the network round-trip).
- Argument-parsing branches with multiple failure modes (a new parser; `parseId` itself is centralized and already covered).
- A response-shape transformation that maps multiple fields or merges two methods' output.
- An error-mapping branch that converts a specific HTTP status to a specific user message.

**Forbidden unit tests** (silent drift, fail-by-tautology):

- `Schema.parse(fixture).toEqual(fixture)` — only proves Zod works.
- `vi.mock('citty')` or `vi.mock('@metabase/client/client')` to "test" a command — collapses to "the mock returned what I configured." If the only way to unit-test a branch is to mock a project helper, push the coverage to e2e instead. The client ships `testing/fake-client.ts` and `testing/fetch-capture.ts` as the sanctioned test doubles; reach for those before a module mock.
- Tests that re-encode the implementation (e.g. asserting the exact arg list a command passed to a resource method).

When in doubt, push coverage to the e2e tier — it runs the real path. A command whose run body is purely "resolve flags, call the client, render" has nothing meaningful to assert at the unit tier; that's fine, and you should say so explicitly when filling in the sanity-check list at the bottom.

## Step 5 — E2E tests (comprehensive)

Live under `tests/e2e/<r>.e2e.test.ts` at the repo root — the e2e tier is workspace-wide, not per-package. Drive the **built** `packages/cli/dist/cli.mjs` against the seeded warehouse via `runCli`. Re-read the `add-e2e-test` skill before writing the file — its runtime contract (no `vi.mock`, no `execa`/`spawn`, env hygiene, per-test config home, opaque license tokens, no `/api/testing/*` calls) is binding here.

A comprehensive suite for a typical list/get pair covers, at minimum:

1. **List, default flags** — `exitCode === 0`, parsed via `<Resource>ListEnvelope` (imported from `packages/cli/src/commands/<r>/list.ts`), asserts the seeded items appear with the expected compact fields via a single `toEqual({ ...full envelope... })` when feasible. If the list is unbounded (paginated or non-deterministic order), assert the _shape_ and the _presence_ of stable items rather than the full array, and still spell out the expected items as full objects.
2. **List, a meaningful filter flag** (if the command has one) — `exitCode === 0`, asserts the filter narrowed the result and that every returned item satisfies the filter.
3. **Get, success** — `exitCode === 0`, parsed via `<Resource>` (with `--full`) or `<Resource>Compact` (default). Assert the parsed object with one `toEqual({ ... })` over the full expected payload, **never** a sequence of `expect(parsed.id).toBe(...)`/`expect(parsed.name).toBe(...)` field pokes. Use a seeded id from `tests/e2e/seed/seeded.ts` (`SEEDED`) or a pinned constant from `tests/e2e/seed/ids.ts`, otherwise look up the id dynamically by listing first and filtering by a known name.
4. **Get, invalid positional** (`abc`, empty, negative, zero) — `exitCode === 2` (`ConfigError`), `stderr.toContain('invalid id: "<value>" (expected integer)')` (the literal message from `packages/cli/src/commands/parse-integer.ts`, which `parseId` delegates to), stdout empty.
5. **Get, valid format but missing on server** (e.g. `9999999`) — `exitCode === 1` (`HttpError`), `stderr.toContain("Not found.")` (the literal `userMessage` from Metabase's 404 envelope; see `packages/client/src/http/errors.ts` for the taxonomy).

Assertions are exact at every level — these are not stylistic preferences, they are hard rules from CLAUDE.md and the `add-e2e-test` skill:

- **Exit codes** — always the exact integer (`toBe(0)`, `toBe(1)`, `toBe(2)`, `toBe(130)`). Never `.not.toBe(0)`. The `packages/client/src/errors.ts` taxonomy is fixed: `ConfigError`=2, `CapabilityError` (`packages/client/src/version/preflight-error.ts`)=2, `AbortError`=130, all others=1.
- **Error strings** — always `toContain("<exact substring>")` or `toBe("<exact full string>")`. Never `toMatch(/.../i)`. Look the literal up in `packages/` and pin it. A regex with `\d+` or `.*` for a dynamic part is FAIL — build the expected string from the same source the production code consumed and assert with `toBe`.
- **Parsed payloads** — always one full `toEqual({ ... })`. Field-by-field `toBe` after `parseJson` is FAIL.

If the command has additional verbs or flags with branching behavior, add a test per branch.

Schemas are imported, never redeclared. E2E tests reach the client by package specifier and the CLI by relative path from the repo root:

- Single item: `<Resource>` / `<Resource>Compact` from `@metabase/client/domain/<r>`.
- List envelope: `<Resource>ListEnvelope` from `../../packages/cli/src/commands/<r>/list`.
- `parseJson` from `@metabase/client/json`.

If the command needs auth (the common case), pass `bootstrap.adminApiKey` and `bootstrap.baseUrl` via `runCli({ env: { MB_URL, MB_API_KEY } })` — never via argv.

## Step 6 — Command-list parity

`packages/cli/src/runtime/command-help.test.ts` has a literal `ALL_COMMANDS` list. Add the new entries (`<r> list`, `<r> get`, …) in the same place new commands appear. Without this update the command-tree contract test fails on a clean run.

## Step 7 — Self-grep before close-out (mandatory)

Run each of these. Any hit must be fixed; then re-run.

```sh
# Domain file (client surface — lives in packages/client):
rg -n "Record<\s*string\s*,\s*unknown\s*>" packages/client/src/domain/<r>.ts && echo FAIL || echo OK
rg -n "\bas \b[A-Z]" packages/client/src/domain/<r>.ts && echo FAIL || echo OK
rg -n ":\s*any\b|<any>" packages/client/src/domain/<r>.ts && echo FAIL || echo OK
rg -n "[\w\)\]]!\." packages/client/src/domain/<r>.ts && echo FAIL || echo OK
rg -n "@ts-(ignore|nocheck|expect-error)" packages/client/src/domain/<r>.ts && echo FAIL || echo OK
rg -n "\.pick\(\{[^}]*\}\)\s*;" packages/client/src/domain/<r>.ts && echo FAIL || echo OK    # `.pick(...)` not followed by `.strip()`
rg -n "@metabase/cli|\.\./\.\./cli/" packages/client/src/domain/<r>.ts && echo FAIL || echo OK   # the client must not reach into the CLI
rg -n "/api/" packages/client/src/domain/<r>.ts && echo FAIL || echo OK   # endpoints belong to resources/

# Resource file (the endpoint layer):
rg -n "\.request(Parsed|Raw|Stream)\(" packages/client/src/resources/<r>.ts || echo "FAIL: no transport call — is this file doing anything?"
rg -n "\$\{[a-zA-Z_$][\w$]*\}" packages/client/src/resources/<r>.ts   # every string interpolation: numeric id, or encodeURIComponent?
rg -n "<r>Resource" packages/client/src/client.ts || echo "FAIL: namespace not composed onto the client"

# Command files (CLI surface — flags in, client call, render out):
rg -n '["`]/api/' packages/cli/src/commands/<r>/ && echo FAIL || echo OK   # the API-path rule
rg -n "\.request(Parsed|Raw|Stream)\(|paginatePages\(" packages/cli/src/commands/<r>/ && echo FAIL || echo OK   # the transport rule
rg -n "from \"\.\./\.\./domain/" packages/cli/src/commands/<r>/ && echo FAIL || echo OK   # use @metabase/client/domain/<r>

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

## Step 8 — Runnable verification (mandatory, all green before close-out)

```sh
bun run check
bun run build
bun run test:e2e tests/e2e/<r>.e2e.test.ts
```

`bun run check` is the whole gate — typecheck, lint, format, then the unit tier: the resource wire tests above, plus every colocated `*.test.ts` in both packages.

If any step fails: fix and re-run, do not paper over. If you cannot run them in your environment, say so explicitly — do not claim "done."

## Step 9 — Close-out: `/review` then `/simplify` (mandatory, in this order)

Both are mandatory and must run **after** Step 8 is green. Do not skip either.

1. **`/review`** — runs the strict end-of-task review skill against the diff. Any FAIL must be addressed before continuing. Do not argue with findings; fix them, or skip with an explicit one-line rationale. Re-run `/review` until it returns `RESULT: PASS`.

2. **`/simplify`** — runs the reuse / quality / efficiency review. Apply each finding that survives the rubric; skip false positives with a one-line note. Resolve any structural issues `/simplify` surfaces (redeclared schemas, missing command-list entries, magic-literal duplication, etc.) by going back to the relevant earlier step.

If either skill surfaces a structural issue (missing `.strip()`, a request built inside a command, a redeclared list envelope, a missing command-list entry, an e2e test missing a coverage axis), the work is unfinished — fix and re-run the close-out from `/review`.

## Sanity checks before declaring done

- [ ] Step 0 actually performed (read existing domain file, resource file + wire test, `client.ts`, list command, get command, e2e test, `packages/cli/src/output/types.ts`, `packages/cli/src/output/window.ts`).
- [ ] Domain file landed in `packages/client/src/domain/`, importing only `zod` and sibling `domain/*` files.
- [ ] **Domain pair**: `<Resource>` with `.loose()`, `<Resource>Compact` with `.pick({...}).strip()`. No hand-written parallel interface.
- [ ] Every value the domain file exports is re-exported from `packages/client/src/index.ts`.
- [ ] Closed enums pinned via `z.enum([...])` where the backend defines a closed set.
- [ ] Schema scope is query/agent-relevant fields only — no sync flags, fingerprints, audit timestamps, or other internal plumbing unless they drive an actual decision.
- [ ] No fixture or schema-parse unit test added.
- [ ] **Resource file** `packages/client/src/resources/<r>.ts` exports `<r>Resource(transport)`, holds every `/api/` path and every transport call, and follows all eight conventions — positional path params then params then options, Metabase's own field names, transport concerns in `options`, wire envelopes module-private, domain values returned, `ListResult<T>` for a non-paginated list, `encodeURIComponent` on every string path param, a doc comment per method.
- [ ] **Namespace composed** onto `packages/client/src/client.ts` as `<r>: <r>Resource(transport)`.
- [ ] **Wire test** `packages/client/src/resources/<r>.test.ts` asserts URL, method, headers and body for every method through `captureFetch`.
- [ ] **View binding** `<resource>View` landed in `packages/cli/src/output/views/<r>.ts` (not the domain file, not the resource file), with any `format:` cell helpers colocated there.
- [ ] **Commands** landed in `packages/cli/src/commands/<r>/`, call `client.<r>.<method>(…)`, and name no `/api/` path and no transport method — the two rules admit no exception.
- [ ] **List command** exports `<Resource>ListEnvelope = listEnvelopeSchema(<Resource>Compact)` and uses it as `outputSchema`.
- [ ] **List command** spreads `...listFlags` and builds its envelope with the window helper that matches who applied the window (`windowList` / `windowServerPage` / `collectForOutput`) — never a hand-rolled object.
- [ ] **Get command** uses `parseId` for the positional integer id.
- [ ] Every leaf command declares `capabilities` explicitly (`{ minVersion: … }` or `null`).
- [ ] `packages/cli/src/main.ts` registers the new subcommand.
- [ ] Command unit test added only where non-orchestration logic exists (or none added, with explicit rationale — "command body is pure orchestration" is acceptable).
- [ ] **E2E test** at `tests/e2e/<r>.e2e.test.ts` covering at minimum: list default, list filtered (if applicable), get success, get invalid id, get missing id.
- [ ] E2E test imports schemas from `@metabase/client/domain/<r>` and `../../packages/cli/src/commands/<r>/list`; no `z.object({...})` redeclaration of any output shape.
- [ ] `packages/cli/src/runtime/command-help.test.ts` `ALL_COMMANDS` list updated with the new leaves.
- [ ] Self-grep step (Step 7) ran clean.
- [ ] `bun run check`, `bun run build`, `bun run test:e2e <new-files>` all exited 0.
- [ ] `/review` returned `PASS`.
- [ ] `/simplify` findings either applied or explicitly skipped with a reason.

If any box is unchecked, the task is unfinished — state explicitly which and continue working.
