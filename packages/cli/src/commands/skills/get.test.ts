import { runCommand } from "citty";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ZodType } from "zod";

import { parseJson } from "@metabase/client/json";

import {
  probeAt,
  seedCachedProbe,
  setupTempCacheHome,
  type TempCacheHome,
  UNREACHABLE_ENV,
} from "../../core/temp-cache-home";
import { ENV_SKILLS_DIR } from "../../core/env";
import { findSkillByName, loadAllSkills, readSkillContent } from "../../core/skills";
import {
  createTempSkillsDir,
  GAMMA_SKILL_MD,
  GAMMA_WITH_ACTIVATION,
  GAMMA_WITHOUT_ACTIVATION,
  type TempSkillsDir,
} from "../../core/temp-skills-dir";
import { fitWithinCap } from "../../output/cap";
import { DEFAULT_MAX_BYTES, FULL_RANGE } from "../../output/types";
import { windowList } from "../../output/window";
import skillsGetCommand, { SkillGetEnvelope } from "./get";

interface CapturedStream {
  chunks: string[];
  parse: <T>(schema: ZodType<T>) => T;
}

function capture(stream: NodeJS.WriteStream): CapturedStream {
  const chunks: string[] = [];
  vi.spyOn(stream, "write").mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  return {
    chunks,
    parse: <T>(schema: ZodType<T>) => parseJson(chunks.join(""), schema, { source: "stdout" }),
  };
}

function gammaContent(body: string) {
  return {
    name: "gamma",
    description: "The transform skill.",
    body,
    references: [],
    templates: [],
  };
}

describe("skills get command", () => {
  let skills: TempSkillsDir;
  let home: TempCacheHome;

  beforeEach(() => {
    home = setupTempCacheHome();
    vi.stubEnv("MB_URL", UNREACHABLE_ENV.MB_URL);
    vi.stubEnv("MB_API_KEY", UNREACHABLE_ENV.MB_API_KEY);
    skills = createTempSkillsDir();
    vi.stubEnv(ENV_SKILLS_DIR, skills.path);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    skills.cleanup();
    home.cleanup();
  });

  it("windows the text output rather than accepting --limit and ignoring it", async () => {
    const stdout = capture(process.stdout);

    await runCommand(skillsGetCommand, {
      rawArgs: ["alpha,beta", "--format", "text", "--limit", "1"],
    });

    expect(stdout.chunks.join("")).toBe(
      "---\nname: alpha\ndescription: The first skill.\n---\n\nAlpha instructions.\n",
    );
  });

  it("prints a skill as written, markers included, and `unavailable: null` without a credential", async () => {
    vi.stubEnv("MB_API_KEY", undefined);
    const stdout = capture(process.stdout);
    const stderr = capture(process.stderr);

    await runCommand(skillsGetCommand, { rawArgs: ["gamma", "--json"] });

    expect(stdout.parse(SkillGetEnvelope)).toEqual({
      returned: 1,
      offset: 0,
      total: 1,
      has_more: false,
      next_offset: null,
      unavailable: null,
      data: [gammaContent(GAMMA_SKILL_MD)],
    });
    expect(stderr.chunks).toEqual([]);
  });

  it("notes in text mode that nothing was filtered without a credential", async () => {
    vi.stubEnv("MB_API_KEY", undefined);
    const stdout = capture(process.stdout);
    const stderr = capture(process.stderr);

    await runCommand(skillsGetCommand, { rawArgs: ["gamma", "--format", "text"] });

    expect(stdout.chunks.join("")).toBe(`${GAMMA_SKILL_MD.trimEnd()}\n`);
    expect(stderr.chunks.join("")).toBe(
      "Skills are unfiltered: no Metabase credential; run inside Metabase RDE, or set MB_URL and MB_API_KEY.\n",
    );
  });

  it("withholds a skill the cached server lacks a feature for and reports it under `unavailable`", async () => {
    await seedCachedProbe(probeAt(58));
    const stdout = capture(process.stdout);
    const stderr = capture(process.stderr);

    await runCommand(skillsGetCommand, { rawArgs: ["gamma", "--json"] });

    expect(stdout.parse(SkillGetEnvelope)).toEqual({
      returned: 0,
      offset: 0,
      total: 0,
      has_more: false,
      next_offset: null,
      unavailable: [
        {
          name: "gamma",
          failure: {
            reason: "version-too-old",
            detail:
              "This operation requires Metabase v59+ (this server is v0.58.0). Upgrade Metabase to use it.",
            feature: "transforms",
            since: 59,
            tokenFeature: null,
            serverVersion: "v0.58.0",
          },
        },
      ],
      data: [],
    });
    expect(stderr.chunks).toEqual([]);
  });

  it("prints nothing but the skipped note in text mode for a withheld skill", async () => {
    await seedCachedProbe(probeAt(58));
    const stdout = capture(process.stdout);
    const stderr = capture(process.stderr);

    await runCommand(skillsGetCommand, { rawArgs: ["gamma", "--format", "text"] });

    expect(stdout.chunks).toEqual([]);
    expect(stderr.chunks.join("")).toBe(
      'Skipped skill "gamma": This operation requires Metabase v59+ (this server is v0.58.0). Upgrade Metabase to use it. Pass --unfiltered to print it anyway.\n',
    );
  });

  it("strips a section the cached server lacks the feature for", async () => {
    await seedCachedProbe(probeAt(60));
    const stdout = capture(process.stdout);

    await runCommand(skillsGetCommand, { rawArgs: ["gamma", "--json"] });

    expect(stdout.parse(SkillGetEnvelope)).toEqual({
      returned: 1,
      offset: 0,
      total: 1,
      has_more: false,
      next_offset: null,
      unavailable: [],
      data: [gammaContent(GAMMA_WITHOUT_ACTIVATION)],
    });
  });

  it("keeps a section the cached server has the feature for, without its markers", async () => {
    await seedCachedProbe(probeAt(61));
    const stdout = capture(process.stdout);

    await runCommand(skillsGetCommand, { rawArgs: ["gamma", "--format", "text"] });

    expect(stdout.chunks.join("")).toBe(`${GAMMA_WITH_ACTIVATION.trimEnd()}\n`);
  });

  it("--unfiltered with a name prints that skill as written regardless of the cached server", async () => {
    await seedCachedProbe(probeAt(58));
    const stdout = capture(process.stdout);
    const stderr = capture(process.stderr);

    await runCommand(skillsGetCommand, { rawArgs: ["gamma", "--unfiltered", "--json"] });

    expect(stdout.parse(SkillGetEnvelope)).toEqual({
      returned: 1,
      offset: 0,
      total: 1,
      has_more: false,
      next_offset: null,
      unavailable: null,
      data: [gammaContent(GAMMA_SKILL_MD)],
    });
    expect(stderr.chunks).toEqual([]);
  });

  it("--all alone selects every non-hidden skill as the cached server can use it", async () => {
    await seedCachedProbe(probeAt(58));
    const stdout = capture(process.stdout);

    await runCommand(skillsGetCommand, { rawArgs: ["--all", "--json", "--max-bytes", "0"] });

    expect(stdout.parse(SkillGetEnvelope)).toEqual({
      returned: 2,
      offset: 0,
      total: 2,
      has_more: false,
      next_offset: null,
      unavailable: [
        {
          name: "gamma",
          failure: {
            reason: "version-too-old",
            detail:
              "This operation requires Metabase v59+ (this server is v0.58.0). Upgrade Metabase to use it.",
            feature: "transforms",
            since: 59,
            tokenFeature: null,
            serverVersion: "v0.58.0",
          },
        },
      ],
      data: [
        {
          name: "alpha",
          description: "The first skill.",
          body: "---\nname: alpha\ndescription: The first skill.\n---\n\nAlpha instructions.\n",
          references: [],
          templates: [],
        },
        {
          name: "beta",
          description: "The second skill.",
          body: "---\nname: beta\ndescription: The second skill.\n---\n\nBeta instructions.\n",
          references: [],
          templates: [],
        },
      ],
    });
  });

  it("--all --unfiltered prints every non-hidden skill as written", async () => {
    await seedCachedProbe(probeAt(58));
    const stdout = capture(process.stdout);

    await runCommand(skillsGetCommand, {
      rawArgs: ["--all", "--unfiltered", "--json", "--max-bytes", "0"],
    });

    expect(stdout.parse(SkillGetEnvelope)).toEqual({
      returned: 3,
      offset: 0,
      total: 3,
      has_more: false,
      next_offset: null,
      unavailable: null,
      data: [
        {
          name: "alpha",
          description: "The first skill.",
          body: "---\nname: alpha\ndescription: The first skill.\n---\n\nAlpha instructions.\n",
          references: [],
          templates: [],
        },
        {
          name: "beta",
          description: "The second skill.",
          body: "---\nname: beta\ndescription: The second skill.\n---\n\nBeta instructions.\n",
          references: [],
          templates: [],
        },
        gammaContent(GAMMA_SKILL_MD),
      ],
    });
  });
});

// `core` is the skill every agent is told to load first, and it is a single indivisible row: once
// its body outgrows the default cap the command has nothing left to drop and refuses outright.
// The ceiling belongs at commit time, not in an agent session.
describe("the shipped core skill", () => {
  it("fits the default output cap as a one-row json envelope", () => {
    const info = findSkillByName(loadAllSkills(), "core");
    const envelope = windowList(
      [readSkillContent(info, { includeExtras: false, profile: null })],
      FULL_RANGE,
    );

    expect(fitWithinCap(envelope, DEFAULT_MAX_BYTES)).toEqual({
      count: 1,
      fullBytes: Buffer.byteLength(JSON.stringify(envelope), "utf8"),
      cut: false,
    });
  });
});
