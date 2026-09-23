import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SKILL_MD_FILENAME } from "./skills";

export interface TempSkillsDir {
  path: string;
  cleanup(): void;
}

interface SkillFixture {
  name: string;
  description: string;
  body: string;
}

const BETA_FRONTMATTER = "---\nname: beta\ndescription: The second skill.\n---\n\n";

export const BETA_SKILL_MD = `${BETA_FRONTMATTER}Beta instructions.\n<!-- requires: remoteSync -->\nBeta on git sync.\n<!-- /requires -->\n`;
export const BETA_WITH_REMOTE_SYNC = `${BETA_FRONTMATTER}Beta instructions.\nBeta on git sync.\n`;
export const BETA_WITHOUT_REMOTE_SYNC = `${BETA_FRONTMATTER}Beta instructions.\n`;

export const GAMMA_SKILL_MD =
  "---\nname: gamma\ndescription: The git-sync skill.\nrequires: [remoteSync]\n---\n\nGamma instructions.\n";

// Pointing MB_SKILLS_DIR here keeps an assertion over rendered output independent of whatever
// skill-data/ happens to ship.
const FIXTURES: readonly SkillFixture[] = [
  { name: "alpha", description: "The first skill.", body: "Alpha instructions.\n" },
];

export function createTempSkillsDir(): TempSkillsDir {
  const path = mkdtempSync(join(tmpdir(), "mb-skills-"));
  for (const fixture of FIXTURES) {
    const dir = join(path, fixture.name);
    mkdirSync(dir);
    writeFileSync(join(dir, SKILL_MD_FILENAME), skillMarkdown(fixture), "utf8");
  }
  mkdirSync(join(path, "beta"));
  writeFileSync(join(path, "beta", SKILL_MD_FILENAME), BETA_SKILL_MD, "utf8");
  mkdirSync(join(path, "gamma"));
  writeFileSync(join(path, "gamma", SKILL_MD_FILENAME), GAMMA_SKILL_MD, "utf8");
  return {
    path,
    cleanup() {
      rmSync(path, { recursive: true, force: true });
    },
  };
}

function skillMarkdown(fixture: SkillFixture): string {
  return `---\nname: ${fixture.name}\ndescription: ${fixture.description}\n---\n\n${fixture.body}`;
}
