import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { isNotFoundError } from "@metabase/cli/errors";

const SKILL_FILE = "SKILL.md";

// `src/skills.ts` and the bundled `dist/cli.mjs` both sit one level under the package root, so the
// same relative walk finds the skills from a source checkout and from an install.
const SKILL_DATA_DIR = resolve(import.meta.dirname, "..", "skill-data");

export class SkillsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillsError";
  }
}

// The agent's skills are its own: they teach the curated tools, and they ship with this package.
// pi is handed the directories rather than the markdown, so a skill is read only when the model
// opens it.
export function metabaseSkillPaths(): string[] {
  const dirs = readSkillDirs();
  if (dirs.length === 0) {
    throw new SkillsError(
      `No skills found in ${SKILL_DATA_DIR}, so the model would have to author MBQL, dashboards, and visualization settings unaided. Reinstall mb-agent.`,
    );
  }
  return dirs;
}

function readSkillDirs(): string[] {
  let entries: string[];
  try {
    entries = readdirSync(SKILL_DATA_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(SKILL_DATA_DIR, entry.name));
  } catch (error) {
    if (isNotFoundError(error)) {
      return [];
    }
    throw error;
  }
  return entries.filter((dir) => existsSync(join(dir, SKILL_FILE)));
}
