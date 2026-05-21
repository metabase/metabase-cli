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

  it("renders the details block after the description and before USAGE when declared", async () => {
    const cmd = defineMetabaseCommand({
      meta: { name: "demo", description: "Short summary" },
      args: {},
      details: "Longer per-command knowledge shown only on this page.",
      run() {
        return;
      },
    });

    await showUsage(cmd);
    const out = chunks.join("");
    const summaryIdx = out.indexOf("Short summary");
    const detailIdx = out.indexOf("Longer per-command knowledge shown only on this page.");
    const usageIdx = out.indexOf("USAGE");
    expect(summaryIdx).toBeGreaterThanOrEqual(0);
    expect(detailIdx).toBeGreaterThan(summaryIdx);
    expect(usageIdx).toBeGreaterThan(detailIdx);
  });

  it("omits the details block when none is declared", async () => {
    const cmd = defineMetabaseCommand({
      meta: { name: "demo", description: "Short summary" },
      args: { foo: { type: "string", description: "the foo flag" } },
      run() {
        return;
      },
    });

    await showUsage(cmd);
    const out = chunks.join("");
    expect(out).toContain("Short summary");
    expect(out).not.toContain("Longer per-command knowledge");
  });

  it("strips citty's column-padding whitespace from short rows so a long description does not bloat every line", async () => {
    const cmd = defineCommand({
      meta: { name: "root", description: "root cmd" },
      subCommands: {
        short: defineCommand({
          meta: { name: "short", description: "Short description" },
          run() {
            return;
          },
        }),
        long: defineCommand({
          meta: {
            name: "long",
            description:
              "This is a much, much longer description that forces citty's formatLineColumns to pad every other row with trailing spaces up to this length.",
          },
          run() {
            return;
          },
        }),
      },
      run() {
        return;
      },
    });

    await showUsage(cmd);
    const out = chunks.join("");
    const shortRow = out.split("\n").find((line) => line.includes("Short description"));
    expect(shortRow).toBeDefined();
    expect(shortRow).toMatch(/Short description$/);
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
