import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z, ZodObject } from "zod";

const VIEWS_DIR = join(dirname(fileURLToPath(import.meta.url)), "views");
const TS_SUFFIX = ".ts";
const TEST_SUFFIX = ".test.ts";

const ModuleNamespace = z.record(z.string(), z.unknown());

const ViewBinding = z.object({
  compactPick: z.unknown(),
  tableColumns: z.array(z.object({ key: z.string() })),
});

interface DiscoveredView {
  module: string;
  name: string;
  binding: z.infer<typeof ViewBinding>;
}

function viewModuleNames(): string[] {
  return readdirSync(VIEWS_DIR)
    .filter((name) => name.endsWith(TS_SUFFIX) && !name.endsWith(TEST_SUFFIX))
    .map((name) => name.slice(0, -TS_SUFFIX.length))
    .toSorted();
}

async function discoverViews(): Promise<DiscoveredView[]> {
  const found: DiscoveredView[] = [];
  for (const module of viewModuleNames()) {
    const namespace = ModuleNamespace.parse(await import(`./views/${module}.ts`));
    for (const [name, value] of Object.entries(namespace)) {
      if (typeof value !== "object" || value === null || !("compactPick" in value)) {
        continue;
      }
      found.push({ module, name, binding: ViewBinding.parse(value) });
    }
  }
  return found;
}

const MODULE_NAMES = viewModuleNames();
const VIEWS = await discoverViews();

describe("output/views bindings", () => {
  it("finds a view binding in every views/ module", () => {
    const barren = MODULE_NAMES.filter((module) => !VIEWS.some((view) => view.module === module));
    expect(barren).toEqual([]);
  });

  // The check is one-directional on purpose. A compactPick key with no column is legitimate — many
  // views carry fields in `--json` that the terminal table has no room for. The reverse is the bug:
  // `render` builds the table from the raw item but projects `--json` through `compactPick`, so a
  // column outside the projection renders in the table and silently vanishes from `--json`.
  for (const view of VIEWS) {
    it(`${view.name} projects every table column through compactPick`, () => {
      const pick = view.binding.compactPick;
      if (!(pick instanceof ZodObject)) {
        throw new Error(
          `${view.name}.compactPick is not a ZodObject, so its projected keys cannot be read`,
        );
      }
      const projected = Object.keys(pick.shape);
      const unprojected = view.binding.tableColumns
        .map((column) => column.key)
        .filter((key) => !projected.includes(key));
      expect(unprojected).toEqual([]);
    });
  }
});
