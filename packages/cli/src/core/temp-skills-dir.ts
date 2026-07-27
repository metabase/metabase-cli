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

const FIXTURES: readonly SkillFixture[] = [
  { name: "alpha", description: "The first skill.", body: "Alpha instructions." },
  { name: "beta", description: "The second skill.", body: "Beta instructions." },
];

// Two skills is the smallest collection that can show a window dropping one. Pointing
// MB_SKILLS_DIR here keeps an assertion over rendered output independent of whatever
// skill-data/ happens to ship.
export function createTempSkillsDir(): TempSkillsDir {
  const path = mkdtempSync(join(tmpdir(), "mb-skills-"));
  for (const fixture of FIXTURES) {
    const dir = join(path, fixture.name);
    mkdirSync(dir);
    writeFileSync(join(dir, SKILL_MD_FILENAME), skillMarkdown(fixture), "utf8");
  }
  return {
    path,
    cleanup() {
      rmSync(path, { recursive: true, force: true });
    },
  };
}

function skillMarkdown(fixture: SkillFixture): string {
  return `---\nname: ${fixture.name}\ndescription: ${fixture.description}\n---\n\n${fixture.body}\n`;
}
