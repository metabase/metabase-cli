import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { expect, test } from "vitest";
import { metabaseSkillPaths } from "./skills";

const AGENT_SKILL_DATA = resolve(import.meta.dirname, "..", "skill-data");

test("hands pi the agent's own skill directories", () => {
  const paths = metabaseSkillPaths();

  expect(paths.map((dir) => basename(dir)).toSorted()).toEqual([
    "core",
    "dashboard",
    "data-workflow",
    "document",
    "git-sync",
    "library",
    "mbql",
    "metadata",
    "native-sql",
    "transform",
    "visualization",
  ]);
  for (const dir of paths) {
    expect(dir.startsWith(AGENT_SKILL_DATA)).toBe(true);
  }
});

test("every directory carries the SKILL.md frontmatter pi needs to list the skill", async () => {
  for (const dir of metabaseSkillPaths()) {
    const frontmatter = (await readFile(join(dir, "SKILL.md"), "utf8")).split("---")[1];
    expect(frontmatter).toContain(`name: ${basename(dir)}`);
    expect(frontmatter).toContain("description: ");
  }
});

// The agent reaches Metabase through its curated tools and nothing else, so a skill that teaches an
// `mb` invocation teaches a command the model cannot run. The CLI's skills are the CLI's.
test("no skill points the model at the mb CLI", async () => {
  for (const file of await skillFiles()) {
    expect(await readFile(file, "utf8")).not.toMatch(/`mb\b/);
  }
});

async function skillFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const dir of metabaseSkillPaths()) {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(join(entry.parentPath, entry.name));
      }
    }
  }
  return files;
}
