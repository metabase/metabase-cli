import { afterEach, assert, describe, expect, it } from "vitest";

import { parseJson } from "@metabase/client/json";

import { SkillGetEnvelope } from "../../packages/cli/src/commands/skills/get";
import { SkillListEnvelope } from "../../packages/cli/src/commands/skills/list";
import { SkillPathListEnvelope } from "../../packages/cli/src/commands/skills/path";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";

const BUNDLED_VISIBLE_NAMES = [
  "core",
  "dashboard",
  "data-workflow",
  "document",
  "git-sync",
  "mbql",
  "metadata",
  "native-sql",
  "notification",
  "transform",
  "transform-test",
  "transform-test-plan",
  "visualization",
] as const;

describe("skills e2e", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function makeIsolatedConfigHome(): Promise<string> {
    const dir = await mkTempConfigHome();
    tempDirs.push(dir);
    return dir;
  }

  it("list returns the thirteen bundled non-hidden skills, sorted by name", async () => {
    const result = await runCli({
      args: ["skills", "list", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const envelope = parseJson(result.stdout, SkillListEnvelope);
    expect(envelope.data.map((s) => s.name)).toEqual([...BUNDLED_VISIBLE_NAMES]);
    expect(envelope.returned).toBe(BUNDLED_VISIBLE_NAMES.length);
    for (const item of envelope.data) {
      expect(item.description.length).toBeGreaterThan(20);
    }
  });

  it("list hides the metabase-cli discovery stub", async () => {
    const result = await runCli({
      args: ["skills", "list", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode).toBe(0);
    const envelope = parseJson(result.stdout, SkillListEnvelope);
    expect(envelope.data.map((s) => s.name)).not.toContain("metabase-cli");
  });

  it("get core returns the SKILL.md body with frontmatter intact and no references unless --full", async () => {
    const result = await runCli({
      args: ["skills", "get", "core", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const envelope = parseJson(result.stdout, SkillGetEnvelope);
    expect(envelope.returned).toBe(1);
    expect(envelope.data).toEqual([
      {
        name: "core",
        description: expect.stringContaining("Foundations for driving Metabase from the terminal"),
        body: expect.stringMatching(/^---\nname: core\n[\s\S]*Top-level command groups/),
        references: [],
        templates: [],
      },
    ]);
  });

  it("get --all returns every non-hidden skill (with --max-bytes 0 to opt out of the list cap)", async () => {
    const result = await runCli({
      args: ["skills", "get", "--all", "--json", "--max-bytes", "0"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const envelope = parseJson(result.stdout, SkillGetEnvelope);
    expect(envelope.data.map((s) => s.name)).toEqual([...BUNDLED_VISIBLE_NAMES]);
    expect(envelope.truncated).toBeUndefined();
  });

  it("get --all under the default byte cap truncates the trailing skills and surfaces a truncation notice", async () => {
    const result = await runCli({
      args: ["skills", "get", "--all", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const envelope = parseJson(result.stdout, SkillGetEnvelope);
    expect(envelope.total).toBe(BUNDLED_VISIBLE_NAMES.length);
    expect(envelope.returned).toBeLessThan(BUNDLED_VISIBLE_NAMES.length);
    expect(envelope.truncated?.reason).toBe("max_bytes");
    expect(result.stderr).toContain("cut at");
  });

  it("get answers a cap too small for even one skill with an empty window and no resumption point", async () => {
    const result = await runCli({
      args: ["skills", "get", "core", "--json", "--max-bytes", "200"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    // What the answer would have measured is the answer itself, uncapped: the notice quotes it so
    // a caller can size the cap that would carry it.
    const uncapped = await runCli({
      args: ["skills", "get", "core", "--json", "--max-bytes", "0"],
      configHome: await makeIsolatedConfigHome(),
    });
    const fullBytes = Buffer.byteLength(uncapped.stdout.trimEnd(), "utf8");

    expect(parseJson(result.stdout, SkillGetEnvelope)).toEqual({
      data: [],
      returned: 0,
      offset: 0,
      total: 1,
      has_more: true,
      next_offset: null,
      truncated: { reason: "max_bytes", bytes: fullBytes },
    });
    expect(result.stderr).toBe(
      `… cut at ${fullBytes} bytes; a skill body is indivisible — pass --max-bytes 0 to print it whole, or \`mb skills path <name>\` to read it from disk`,
    );
  });

  it("get --all walking next_offset under the default cap terminates and yields every skill once", async () => {
    const configHome = await makeIsolatedConfigHome();
    const names: string[] = [];
    let offset = 0;

    for (let iteration = 0; iteration < BUNDLED_VISIBLE_NAMES.length; iteration += 1) {
      const result = await runCli({
        args: ["skills", "get", "--all", "--json", "--offset", String(offset)],
        configHome,
      });
      expect(result.exitCode, result.stderr).toBe(0);
      const envelope = parseJson(result.stdout, SkillGetEnvelope);
      expect(envelope.returned).toBeGreaterThan(0);
      names.push(...envelope.data.map((skill) => skill.name));
      if (!envelope.has_more) {
        expect(names).toEqual([...BUNDLED_VISIBLE_NAMES]);
        return;
      }
      const next = envelope.next_offset;
      assert(next !== null && next !== undefined, "has_more must come with a next_offset");
      expect(next).toBe(offset + envelope.returned);
      offset = next;
    }

    throw new Error(`walk did not terminate; collected ${names.length} skills`);
  });

  it("get accepts comma-separated names", async () => {
    const result = await runCli({
      args: ["skills", "get", "git-sync,transform", "--json", "--max-bytes", "0"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const envelope = parseJson(result.stdout, SkillGetEnvelope);
    expect(envelope.data.map((s) => s.name)).toEqual(["git-sync", "transform"]);
  });

  it("get rejects an unknown skill name with exit 2 and a ConfigError message listing available names", async () => {
    const result = await runCli({
      args: ["skills", "get", "does-not-exist"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      `unknown skill name(s): does-not-exist (available: ${BUNDLED_VISIBLE_NAMES.join(", ")})`,
    );
  });

  it("get without a name or --all errors with exit 2", async () => {
    const result = await runCli({
      args: ["skills", "get"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("provide a skill name (comma-separated for multiple) or --all");
  });

  it("path with no name lists every non-hidden skill's directory", async () => {
    const result = await runCli({
      args: ["skills", "path", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const envelope = parseJson(result.stdout, SkillPathListEnvelope);
    expect(envelope.data.map((s) => s.name)).toEqual([...BUNDLED_VISIBLE_NAMES]);
    for (const item of envelope.data) {
      expect(item.dir.endsWith(`/skill-data/${item.name}`)).toBe(true);
    }
  });

  it("path <name> returns a single-item envelope", async () => {
    const result = await runCli({
      args: ["skills", "path", "core", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const envelope = parseJson(result.stdout, SkillPathListEnvelope);
    expect(envelope.returned).toBe(1);
    expect(envelope.data).toHaveLength(1);
    const item = envelope.data[0];
    assert(item !== undefined, "expected one item in the envelope");
    expect(item.name).toBe("core");
    expect(item.dir.endsWith("/skill-data/core")).toBe(true);
  });
});
