import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import type { z } from "zod";

import { parseJson } from "@metabase/client/json";

import { SkillGetEnvelope } from "../../packages/cli/src/commands/skills/get";
import { SkillListEnvelope } from "../../packages/cli/src/commands/skills/list";
import { SkillPathListEnvelope } from "../../packages/cli/src/commands/skills/path";
import {
  discoverSkills,
  type SkillContent,
  type SkillInfo,
} from "../../packages/cli/src/core/skills";
import { fitWithinCap } from "../../packages/cli/src/output/cap";
import { DEFAULT_MAX_BYTES } from "../../packages/cli/src/output/types";
import { cliErrorMessage } from "./cli-error";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { seedProbedProfile, seedProbedProfileAt, UNREACHABLE, versionAt } from "./seed-profile";

type SkillGetPayload = z.infer<typeof SkillGetEnvelope>;

// The shipped skills are the expected values: the binary under test bundles this very directory.
const SKILL_DATA_DIR = resolve(import.meta.dirname, "..", "..", "packages", "cli", "skill-data");
const BUNDLED_VISIBLE = discoverSkills([SKILL_DATA_DIR]).filter((skill) => !skill.hidden);

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
  "visualization",
] as const;

const UNFILTERED_NOTE =
  'Skills are unfiltered: there is no profile "default" (run `mb auth login` to create one and record its server).';
const SKILL_OVERSIZE_HINT =
  "a skill body is indivisible — pass --max-bytes 0 to print it whole, or `mb skills path <name>` to read it from disk";

function bundledSkill(name: string): SkillInfo {
  const skill = BUNDLED_VISIBLE.find((candidate) => candidate.name === name);
  if (skill === undefined) {
    throw new Error(`no bundled skill named "${name}" under ${SKILL_DATA_DIR}`);
  }
  return skill;
}

function listRow(skill: SkillInfo): z.infer<typeof SkillListEnvelope>["data"][number] {
  return { name: skill.name, description: skill.description };
}

// A skill as `skills get` prints it with nothing to resolve against: SKILL.md verbatim, no extras.
function asWritten(skill: SkillInfo): SkillContent {
  return {
    name: skill.name,
    description: skill.description,
    body: readFileSync(join(skill.dir, "SKILL.md"), "utf8"),
    references: [],
    templates: [],
  };
}

function fullList(rows: readonly SkillInfo[]): z.infer<typeof SkillListEnvelope> {
  return {
    data: rows.map(listRow),
    returned: rows.length,
    offset: 0,
    total: rows.length,
    has_more: false,
    next_offset: null,
    unavailable: null,
  };
}

// The names a text listing prints at column zero; descriptions sit indented beneath them.
function namesInTextListing(stdout: string): string[] {
  return stdout.split("\n").filter((line) => line !== "" && !line.startsWith("  "));
}

function onlySkill(envelope: SkillGetPayload): SkillContent {
  const [item, ...rest] = envelope.data;
  if (item === undefined || rest.length > 0) {
    throw new Error(`expected exactly one skill in the envelope, got ${envelope.data.length}`);
  }
  return item;
}

const TRANSFORM_UNAVAILABLE_ON_58 = {
  name: "transform",
  failure: {
    reason: "version-too-old",
    detail:
      "This operation requires Metabase v59+ (this server is v0.58.0). Upgrade Metabase to use it.",
    feature: "transforms",
    since: 59,
    tokenFeature: null,
    serverVersion: "v0.58.0",
  },
};

const GIT_SYNC_UNAVAILABLE_ON_58 = {
  name: "git-sync",
  failure: {
    reason: "version-too-old",
    detail:
      "This operation requires Metabase v60+ (this server is v0.58.0). Upgrade Metabase to use it.",
    feature: "remoteSync",
    since: 60,
    tokenFeature: "remote_sync",
    serverVersion: "v0.58.0",
  },
};

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

  it("ships exactly the eleven visible skills this suite names", () => {
    expect(BUNDLED_VISIBLE.map((skill) => skill.name)).toEqual([...BUNDLED_VISIBLE_NAMES]);
  });

  it("list returns the eleven bundled non-hidden skills, sorted by name, with `unavailable: null` and a clean stderr when there is no cached probe", async () => {
    const result = await runCli({
      args: ["skills", "list", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, SkillListEnvelope)).toEqual(fullList(BUNDLED_VISIBLE));
    expect(result.stderr).toBe("");
  });

  it("list in text mode notes that nothing was filtered when there is no cached probe", async () => {
    const result = await runCli({
      args: ["skills", "list", "--format", "text"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode).toBe(0);
    expect(namesInTextListing(result.stdout)).toEqual([...BUNDLED_VISIBLE_NAMES]);
    expect(result.stderr).toBe(UNFILTERED_NOTE);
  });

  it("list against a v58 profile omits the feature-bound skills and reports them under `unavailable`", async () => {
    const configHome = await makeIsolatedConfigHome();
    await seedProbedProfile(configHome, 58);

    const result = await runCli({ args: ["skills", "list", "--json"], configHome });

    expect(result.exitCode, result.stderr).toBe(0);
    const usable = BUNDLED_VISIBLE.filter(
      (skill) => skill.name !== "git-sync" && skill.name !== "transform",
    );
    expect(parseJson(result.stdout, SkillListEnvelope)).toEqual({
      ...fullList(usable),
      unavailable: [GIT_SYNC_UNAVAILABLE_ON_58, TRANSFORM_UNAVAILABLE_ON_58],
    });
    expect(result.stderr).toBe("");
  });

  it("list --unfiltered against a v58 profile lists every skill and reports `unavailable: null`", async () => {
    const configHome = await makeIsolatedConfigHome();
    await seedProbedProfile(configHome, 58);

    const result = await runCli({
      args: ["skills", "list", "--unfiltered", "--json"],
      configHome,
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, SkillListEnvelope)).toEqual(fullList(BUNDLED_VISIBLE));
    expect(result.stderr).toBe("");
  });

  it("list in text mode against a v58 profile names each skipped skill on stderr", async () => {
    const configHome = await makeIsolatedConfigHome();
    await seedProbedProfile(configHome, 58);

    const result = await runCli({ args: ["skills", "list", "--format", "text"], configHome });

    expect(result.exitCode).toBe(0);
    expect(namesInTextListing(result.stdout)).toEqual(
      BUNDLED_VISIBLE_NAMES.filter((name) => name !== "git-sync" && name !== "transform"),
    );
    expect(result.stderr).toBe(
      [
        `Skipped skill "git-sync": ${GIT_SYNC_UNAVAILABLE_ON_58.failure.detail} Pass --unfiltered to print it anyway.`,
        `Skipped skill "transform": ${TRANSFORM_UNAVAILABLE_ON_58.failure.detail} Pass --unfiltered to print it anyway.`,
      ].join("\n"),
    );
  });

  it("get transform against a v58 profile withholds the body, and --unfiltered prints it", async () => {
    const configHome = await makeIsolatedConfigHome();
    await seedProbedProfile(configHome, 58);

    const withheld = await runCli({ args: ["skills", "get", "transform", "--json"], configHome });
    expect(withheld.exitCode, withheld.stderr).toBe(0);
    expect(parseJson(withheld.stdout, SkillGetEnvelope)).toEqual({
      data: [],
      returned: 0,
      offset: 0,
      total: 0,
      has_more: false,
      next_offset: null,
      unavailable: [TRANSFORM_UNAVAILABLE_ON_58],
    });

    const printed = await runCli({
      args: ["skills", "get", "transform", "--unfiltered", "--json", "--max-bytes", "0"],
      configHome,
    });
    expect(printed.exitCode, printed.stderr).toBe(0);
    expect(parseJson(printed.stdout, SkillGetEnvelope)).toEqual({
      data: [asWritten(bundledSkill("transform"))],
      returned: 1,
      offset: 0,
      total: 1,
      has_more: false,
      next_offset: null,
      unavailable: null,
    });
  });

  it("get core resolves its sections against the cached server: an OSS v58 loses the library bullet, an EE v63 keeps it without markers", async () => {
    const oss58 = await makeIsolatedConfigHome();
    await seedProbedProfile(oss58, 58);
    const ee63 = await makeIsolatedConfigHome();
    await seedProbedProfileAt(ee63, UNREACHABLE, versionAt(63), {
      library: true,
      remote_sync: true,
      content_translation: true,
    });

    const onOss58 = await runCli({ args: ["skills", "get", "core", "--json"], configHome: oss58 });
    const onEe63 = await runCli({ args: ["skills", "get", "core", "--json"], configHome: ee63 });
    const unfiltered = await runCli({
      args: ["skills", "get", "core", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(onOss58.exitCode, onOss58.stderr).toBe(0);
    expect(onEe63.exitCode, onEe63.stderr).toBe(0);
    expect(unfiltered.exitCode, unfiltered.stderr).toBe(0);
    const oss58Body = onlySkill(parseJson(onOss58.stdout, SkillGetEnvelope)).body;
    const ee63Body = onlySkill(parseJson(onEe63.stdout, SkillGetEnvelope)).body;

    expect(oss58Body).not.toContain("**library.**");
    expect(oss58Body).not.toContain("**transform.**");
    expect(oss58Body).not.toContain("<!-- requires");
    expect(ee63Body).toContain("**library.**");
    expect(ee63Body).toContain("**transform.**");
    expect(ee63Body).not.toContain("<!-- requires");
    expect(onlySkill(parseJson(unfiltered.stdout, SkillGetEnvelope))).toEqual(
      asWritten(bundledSkill("core")),
    );
  });

  it("get core returns the SKILL.md body with frontmatter intact and no references unless --full", async () => {
    const result = await runCli({
      args: ["skills", "get", "core", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, SkillGetEnvelope)).toEqual({
      data: [asWritten(bundledSkill("core"))],
      returned: 1,
      offset: 0,
      total: 1,
      has_more: false,
      next_offset: null,
      unavailable: null,
    });
  });

  it("get --all returns every non-hidden skill (with --max-bytes 0 to opt out of the list cap)", async () => {
    const result = await runCli({
      args: ["skills", "get", "--all", "--json", "--max-bytes", "0"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, SkillGetEnvelope)).toEqual({
      data: BUNDLED_VISIBLE.map(asWritten),
      returned: BUNDLED_VISIBLE.length,
      offset: 0,
      total: BUNDLED_VISIBLE.length,
      has_more: false,
      next_offset: null,
      unavailable: null,
    });
    expect(result.stderr).toBe("");
  });

  it("get --all under the default byte cap truncates the trailing skills and surfaces a truncation notice", async () => {
    const result = await runCli({
      args: ["skills", "get", "--all", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    // The uncapped answer is what the cap measured; the leading rows that fit it are the window.
    const uncapped = await runCli({
      args: ["skills", "get", "--all", "--json", "--max-bytes", "0"],
      configHome: await makeIsolatedConfigHome(),
    });
    const whole = parseJson(uncapped.stdout, SkillGetEnvelope);
    const fit = fitWithinCap(whole, DEFAULT_MAX_BYTES);
    expect(fit.fullBytes).toBe(Buffer.byteLength(uncapped.stdout.trimEnd(), "utf8"));
    expect(fit.cut).toBe(true);
    expect(fit.count > 0 && fit.count < BUNDLED_VISIBLE.length).toBe(true);
    expect(parseJson(result.stdout, SkillGetEnvelope)).toEqual({
      data: BUNDLED_VISIBLE.slice(0, fit.count).map(asWritten),
      returned: fit.count,
      offset: 0,
      total: BUNDLED_VISIBLE.length,
      has_more: true,
      next_offset: fit.count,
      truncated: { reason: "max_bytes", bytes: fit.fullBytes },
      unavailable: null,
    });
    expect(result.stderr).toBe(
      `… cut at ${fit.fullBytes} bytes; continue with --offset ${fit.count}, ${SKILL_OVERSIZE_HINT}`,
    );
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
      unavailable: null,
    });
    expect(result.stderr).toBe(`… cut at ${fullBytes} bytes; ${SKILL_OVERSIZE_HINT}`);
  });

  it("get --all walking next_offset under the default cap terminates and yields every skill once", async () => {
    const configHome = await makeIsolatedConfigHome();
    const pages: SkillGetPayload[] = [];
    let offset: number | null = 0;

    // Every page carries at least one skill, so the walk is over within one page per skill.
    while (offset !== null && pages.length < BUNDLED_VISIBLE.length) {
      const result = await runCli({
        args: ["skills", "get", "--all", "--json", "--offset", String(offset)],
        configHome,
      });
      expect(result.exitCode, result.stderr).toBe(0);
      const page = parseJson(result.stdout, SkillGetEnvelope);
      pages.push(page);
      offset = page.has_more && typeof page.next_offset === "number" ? page.next_offset : null;
    }

    expect(pages.flatMap((page) => page.data)).toEqual(BUNDLED_VISIBLE.map(asWritten));
    expect(pages.map((page) => page.has_more)).toEqual([...pages.slice(1).map(() => true), false]);
    expect(pages.map((page) => page.next_offset)).toEqual([
      ...pages.slice(1).map((page) => page.offset),
      null,
    ]);
  });

  it("get accepts comma-separated names", async () => {
    const result = await runCli({
      args: ["skills", "get", "git-sync,transform", "--json", "--max-bytes", "0"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, SkillGetEnvelope)).toEqual({
      data: [asWritten(bundledSkill("git-sync")), asWritten(bundledSkill("transform"))],
      returned: 2,
      offset: 0,
      total: 2,
      has_more: false,
      next_offset: null,
      unavailable: null,
    });
  });

  it("get rejects an unknown skill name with exit 2 and a ConfigError message listing available names", async () => {
    const result = await runCli({
      args: ["skills", "get", "does-not-exist"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(
      `unknown skill name(s): does-not-exist (available: ${BUNDLED_VISIBLE_NAMES.join(", ")})`,
    );
  });

  it("get without a name or --all errors with exit 2", async () => {
    const result = await runCli({
      args: ["skills", "get"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(
      "provide a skill name (comma-separated for multiple) or --all",
    );
  });

  it("path with no name lists every non-hidden skill's directory", async () => {
    const result = await runCli({
      args: ["skills", "path", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, SkillPathListEnvelope)).toEqual({
      data: BUNDLED_VISIBLE.map((skill) => ({ name: skill.name, dir: skill.dir })),
      returned: BUNDLED_VISIBLE.length,
      offset: 0,
      total: BUNDLED_VISIBLE.length,
      has_more: false,
      next_offset: null,
    });
  });

  it("path <name> returns a single-item envelope", async () => {
    const result = await runCli({
      args: ["skills", "path", "core", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, SkillPathListEnvelope)).toEqual({
      data: [{ name: "core", dir: bundledSkill("core").dir }],
      returned: 1,
      offset: 0,
      total: 1,
      has_more: false,
      next_offset: null,
    });
  });
});
