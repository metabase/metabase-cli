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

const GAMMA_FRONTMATTER =
  "---\nname: gamma\ndescription: The transform skill.\nrequires: [transforms]\n---\n\n";

export const GAMMA_SKILL_MD = `${GAMMA_FRONTMATTER}Gamma instructions.\n<!-- requires: transformJobActivation -->\nGamma on activation.\n<!-- /requires -->\n`;
export const GAMMA_WITH_ACTIVATION = `${GAMMA_FRONTMATTER}Gamma instructions.\nGamma on activation.\n`;
export const GAMMA_WITHOUT_ACTIVATION = `${GAMMA_FRONTMATTER}Gamma instructions.\n`;

// Pointing MB_SKILLS_DIR here keeps an assertion over rendered output independent of whatever
// skill-data/ happens to ship.
const FIXTURES: readonly SkillFixture[] = [
  { name: "alpha", description: "The first skill.", body: "Alpha instructions.\n" },
  { name: "beta", description: "The second skill.", body: "Beta instructions.\n" },
];

export function createTempSkillsDir(): TempSkillsDir {
  const path = mkdtempSync(join(tmpdir(), "mb-skills-"));
  for (const fixture of FIXTURES) {
    const dir = join(path, fixture.name);
    mkdirSync(dir);
    writeFileSync(join(dir, SKILL_MD_FILENAME), skillMarkdown(fixture), "utf8");
  }
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
