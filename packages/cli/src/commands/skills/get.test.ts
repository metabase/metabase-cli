import { runCommand } from "citty";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ENV_SKILLS_DIR } from "../../core/env";
import { findSkillByName, loadAllSkills, readSkillContent } from "../../core/skills";
import { createTempSkillsDir, type TempSkillsDir } from "../../core/temp-skills-dir";
import { fitWithinCap } from "../../output/cap";
import { DEFAULT_MAX_BYTES, FULL_RANGE } from "../../output/types";
import { windowList } from "../../output/window";
import skillsGetCommand from "./get";

function captureStdout(): string[] {
  const chunks: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  return chunks;
}

describe("skills get command", () => {
  let skills: TempSkillsDir;

  beforeEach(() => {
    skills = createTempSkillsDir();
    vi.stubEnv(ENV_SKILLS_DIR, skills.path);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    skills.cleanup();
  });

  it("windows the text output rather than accepting --limit and ignoring it", async () => {
    const chunks = captureStdout();

    await runCommand(skillsGetCommand, {
      rawArgs: ["alpha,beta", "--format", "text", "--limit", "1"],
    });

    expect(chunks.join("")).toBe(
      "---\nname: alpha\ndescription: The first skill.\n---\n\nAlpha instructions.\n",
    );
  });
});

// `core` is the skill every agent is told to load first, and it is a single indivisible row: once
// its body outgrows the default cap the command has nothing left to drop and refuses outright.
// The ceiling belongs at commit time, not in an agent session.
describe("the shipped core skill", () => {
  it("fits the default output cap as a one-row json envelope", () => {
    const info = findSkillByName(loadAllSkills(), "core");
    const envelope = windowList([readSkillContent(info, { includeExtras: false })], FULL_RANGE);

    expect(fitWithinCap(envelope, DEFAULT_MAX_BYTES)).toEqual({
      count: 1,
      fullBytes: Buffer.byteLength(JSON.stringify(envelope), "utf8"),
      cut: false,
    });
  });
});
