---
name: add-domain-resource
description: Add a new Metabase API resource to `src/domain/` — Zod schema, compact projection, and view. Use whenever the user asks to "add a card/dashboard/<resource> to domain", "wire up `/api/<endpoint>` as a typed resource", "support a new resource type in src/domain", or anything that introduces a cross-network value that doesn't yet have a schema. Loading this skill is mandatory before generating any file under `src/domain/` or any command that consumes a previously-untyped API response.
---

# add-domain-resource

Authoritative contract for adding a Metabase API resource. Reading this is required before generating files; the rules below are stricter than what general TypeScript intuition will produce.

## Step 0 — Pre-flight (mandatory, do not skip)

Before generating anything, anchor to the existing house style:

1. `ls src/domain/` — see what's already there.
2. Read **one** existing resource file end-to-end (e.g. `src/domain/user.ts`) and its colocated test if present.
3. Read `src/domain/view.ts` to confirm the `ColumnDef<T>` and `ResourceView<T>` shapes you will consume.

Skip this step and you will produce drift — import ordering, naming, view shape — that the type-checker won't catch.

## What you must produce

For every new resource, three artifacts in three locations — no more, no less:

1. `src/domain/<r>.ts` — schema + compact + view (per-resource contract below).
2. `tests/fixtures/<r>/sample.json` — one realistic payload from a real Metabase response.
3. A colocated unit test (e.g. `src/domain/<r>.test.ts`) that parses the fixture through the full schema and asserts the parsed value.

If you skip any of the three, you have not finished the task.

## The three-export contract (per resource)

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

export const CardCompact = Card.pick({ id: true, name: true, archived: true });
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
- The compact projection is the **agent-facing contract** — it is what shows up in list output and `--detail compact` JSON. Pick the smallest set of fields that uniquely identifies + describes the resource for an LLM caller.
- `tableColumns` keys must be valid keys of the **compact** type (the projection drives both JSON and text output).
- Type aliases via `z.infer<typeof X>`. Never hand-write a parallel `interface` — it will drift silently.
- **Optional vs. nullable.** Metabase returns `null` for absent values; it rarely omits the key. Default to `z.string().nullable()` (or whatever base type) and reach for `.optional()` only when you have observed the key actually missing in a real fixture. Wrong here causes silent parse failures on real payloads.

## What you must NOT do

- Do not type an API response as `Array<Record<string, unknown>>`, `any`, `unknown`, or an inline `{ ... }` shape cast. The Zod schema is the single source of truth; downstream code consumes `z.infer<typeof Schema>`.
- Do not edit an existing command to wire schemas into it. Adding a resource is **purely additive**: drop the file, drop the fixture, drop the test. Commands import what they need on their own schedule.
- Do not declare a separate `interface Card { ... }` next to `const Card = z.object(...)`. Use the inferred type alias.
- Do not put the schema anywhere except `src/domain/`. No `src/schemas.ts`, no `src/api.ts`, no `commands/<x>/types.ts`.

## Fixture + test (the third leg)

Fixture at `tests/fixtures/<r>/sample.json`. Use a real, complete payload — copy from a live Metabase response, do not invent one. Keep unknown/extra fields in the fixture so `.loose()` is exercised.

Test:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseJson } from "../runtime/json";
import { Card, cardView } from "./card";

const samplePath = fileURLToPath(new URL("../../tests/fixtures/card/sample.json", import.meta.url));

describe("Card", () => {
  it("parses the sample fixture", () => {
    expect(parseJson(readFileSync(samplePath, "utf8"), Card)).toMatchObject({
      id: expect.any(Number),
      name: expect.any(String),
    });
  });

  it("cardView declares table columns", () => {
    expect(cardView.tableColumns.map((column) => column.key)).toEqual(["id", "name", "archived"]);
  });
});
```

Use `parseJson(text, Card)` — never `JSON.parse(text)` followed by `Card.parse(raw)`. That duplication is what `parseJson` exists to prevent.

## Step N − 1 — Self-grep before declaring done (mandatory)

Run each of these against the file you just wrote. Any hit must be fixed; then re-run.

```sh
# Forbidden in production domain code:
rg -n "Record<\s*string\s*,\s*unknown\s*>" src/domain/<r>.ts && echo FAIL || echo OK
rg -n "\bas \b[A-Z]" src/domain/<r>.ts && echo FAIL || echo OK
rg -n ":\s*any\b|<any>" src/domain/<r>.ts && echo FAIL || echo OK
rg -n "[\w\)\]]!\." src/domain/<r>.ts && echo FAIL || echo OK
rg -n "@ts-(ignore|nocheck|expect-error)" src/domain/<r>.ts && echo FAIL || echo OK
rg -n "interface\s+<Resource>\b" src/domain/<r>.ts && echo FAIL || echo OK   # hand-written parallel interface

# In the test file:
rg -n "JSON\.parse\(" src/domain/<r>.test.ts && echo FAIL || echo OK         # must use parseJson
```

Replace `<r>` / `<Resource>` with your actual file/resource name.

## Step N — Runnable verification (mandatory, must be GREEN before "done")

Run both. Both must pass with zero output / zero failures. If either fails, fix and re-run; do not paper over.

```sh
npx tsc --noEmit
bun run test src/domain/<r>.test.ts
```

If you cannot run them in your environment, say so explicitly — do not claim "done."

## Sanity checks before declaring done

- [ ] Step 0 (read existing domain file) was actually performed.
- [ ] The file exports exactly the trio per resource (schema + Compact + View).
- [ ] Type alias is `z.infer<typeof X>` for every schema, not a hand-written interface.
- [ ] `.loose()` on the full schema; `.pick({...})` on the compact.
- [ ] Fixture exists at `tests/fixtures/<r>/sample.json` and includes at least one extra field beyond the schema (proves loose mode).
- [ ] Test parses via `parseJson(..., <Resource>)` and asserts on the parsed value.
- [ ] No command file was edited to "wire it up." If a command needs the schema, that is a separate change with its own justification.
- [ ] Self-grep step ran clean (no FAIL lines).
- [ ] `npx tsc --noEmit` exited 0.
- [ ] `bun run test src/domain/<r>.test.ts` exited 0.

If any box is unchecked, the task is unfinished — do not report it as done. State explicitly which box is unchecked and continue working.
