import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import main from "../main";
import { buildHelpIndex } from "../runtime/command-help";
import { COMMAND_SURFACE, renderSurfaceTable } from "./surface";

const README_PATH = resolve(fileURLToPath(import.meta.url), "../../../../../README.md");

describe("the command surface", () => {
  it("is exactly what help --json lists at the root", async () => {
    const index = await buildHelpIndex(main, []);
    expect(index.commands.map((entry) => entry.command)).toEqual([...COMMAND_SURFACE]);
  });

  it("is the README's command table, rendered from the root help index", async () => {
    const index = await buildHelpIndex(main, []);
    const readme = readFileSync(README_PATH, "utf8");
    expect(readme).toContain(renderSurfaceTable(index.commands));
  });
});
