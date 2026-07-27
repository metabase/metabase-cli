import { runCommand } from "citty";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ENV_SKILLS_DIR } from "../../core/env";
import { createTempSkillsDir, type TempSkillsDir } from "../../core/temp-skills-dir";
import skillsListCommand from "./list";

function captureStdout(): string[] {
  const chunks: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  return chunks;
}

describe("skills list command", () => {
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

  it("windows the text listing rather than accepting --limit and ignoring it", async () => {
    const chunks = captureStdout();

    await runCommand(skillsListCommand, { rawArgs: ["--format", "text", "--limit", "1"] });

    expect(chunks.join("")).toBe("alpha\n  The first skill.\n\n");
  });
});
