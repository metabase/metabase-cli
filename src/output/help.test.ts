import { defineCommand } from "citty";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { defineMetabaseCommand } from "../commands/runtime";

import { showUsage } from "./help";

describe("showUsage", () => {
  let chunks: string[];

  beforeEach(() => {
    chunks = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("strips citty's '(<command name>)' breadcrumb suffix from the description line", async () => {
    const cmd = defineCommand({
      meta: { name: "demo", description: "Show authentication status for a profile" },
      args: { foo: { type: "string", description: "f" } },
      run() {
        return;
      },
    });

    await showUsage(cmd);
    const out = chunks.join("");
    expect(out).toContain("Show authentication status for a profile");
    expect(out).not.toMatch(/\(demo[^)]*\)/);
  });

  it("preserves the rest of the help body", async () => {
    const cmd = defineCommand({
      meta: { name: "demo", description: "demo cmd" },
      args: { foo: { type: "string", description: "the foo flag" } },
      run() {
        return;
      },
    });

    await showUsage(cmd);
    const out = chunks.join("");
    expect(out).toContain("USAGE");
    expect(out).toContain("--foo");
    expect(out).toContain("the foo flag");
  });

  it("appends an EXAMPLES section when defineMetabaseCommand declares examples", async () => {
    const cmd = defineMetabaseCommand({
      meta: { name: "demo", description: "demo cmd" },
      args: {},
      examples: ["mb demo --json", "mb demo --profile staging"],
      outputSchema: z.object({ ok: z.boolean() }),
      run() {
        return;
      },
    });

    await showUsage(cmd);
    const out = chunks.join("");
    expect(out).toContain("EXAMPLES");
    expect(out).toContain("mb demo --json");
    expect(out).toContain("mb demo --profile staging");
  });

  it("omits the EXAMPLES section when no examples are declared", async () => {
    const cmd = defineMetabaseCommand({
      meta: { name: "demo", description: "demo cmd" },
      args: {},
      run() {
        return;
      },
    });

    await showUsage(cmd);
    const out = chunks.join("");
    expect(out).not.toContain("EXAMPLES");
  });

  it("appends a SCHEMA section pointing to __manifest on every help page", async () => {
    const cmd = defineCommand({
      meta: { name: "demo", description: "demo cmd" },
      args: {},
      run() {
        return;
      },
    });

    await showUsage(cmd);
    const out = chunks.join("");
    expect(out).toContain("SCHEMA");
    expect(out).toContain("mb __manifest");
  });
});
