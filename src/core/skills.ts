import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { parseYamlResult } from "../runtime/yaml";

import { ConfigError, isNotFoundError } from "./errors";

export const Frontmatter = z
  .object({
    name: z.string().min(1),
    description: z.string().default(""),
    hidden: z.boolean().default(false),
  })
  .loose();
export type Frontmatter = z.infer<typeof Frontmatter>;

export const SkillExtraFile = z.object({
  path: z.string(),
  content: z.string(),
});
export type SkillExtraFile = z.infer<typeof SkillExtraFile>;

export const SkillContent = z.object({
  name: z.string(),
  description: z.string(),
  body: z.string(),
  references: z.array(SkillExtraFile),
  templates: z.array(SkillExtraFile),
});
export type SkillContent = z.infer<typeof SkillContent>;

export interface SkillInfo {
  name: string;
  description: string;
  hidden: boolean;
  dir: string;
}

export interface ReadSkillContentOptions {
  includeExtras: boolean;
}

export const SKILL_DIR_NAMES = ["skills", "skill-data"] as const;
export const SKILL_MD_FILENAME = "SKILL.md";
export const SKILL_REFERENCES_DIR = "references";
export const SKILL_TEMPLATES_DIR = "templates";
export const SKILLS_DIR_ENV = "MB_SKILLS_DIR";

const FRONTMATTER_PREFIX_BYTES = 8192;
const FRONTMATTER_FENCE = "---";

export function loadAllSkills(): SkillInfo[] {
  return discoverSkills(resolveSkillDirs());
}

export function loadVisibleSkills(): SkillInfo[] {
  return loadAllSkills().filter((s) => !s.hidden);
}

export function findSkillByName(all: readonly SkillInfo[], name: string): SkillInfo {
  const hit = all.find((s) => s.name === name);
  if (hit === undefined) {
    throw new ConfigError(`unknown skill name: ${name} (${availableSkillNames(all)})`);
  }
  return hit;
}

export function selectSkillsByNames(
  all: readonly SkillInfo[],
  requested: readonly string[],
): SkillInfo[] {
  if (requested.length === 0) {
    throw new ConfigError("no skill names provided");
  }
  const byName = new Map<string, SkillInfo>(all.map((s) => [s.name, s]));
  const missing: string[] = [];
  const found: SkillInfo[] = [];
  for (const name of requested) {
    const hit = byName.get(name);
    if (hit === undefined) {
      missing.push(name);
      continue;
    }
    found.push(hit);
  }
  if (missing.length > 0) {
    throw new ConfigError(
      `unknown skill name(s): ${missing.join(", ")} (${availableSkillNames(all)})`,
    );
  }
  return found;
}

export function availableSkillNames(all: readonly SkillInfo[]): string {
  const names = all.filter((s) => !s.hidden).map((s) => s.name);
  return `available: ${names.length === 0 ? "none" : names.join(", ")}`;
}

export function resolveSkillDirs(): string[] {
  const override = process.env[SKILLS_DIR_ENV];
  if (override !== undefined && override !== "") {
    if (!isDirectory(override)) {
      throw new ConfigError(`${SKILLS_DIR_ENV} points at ${override}, which is not a directory`);
    }
    return [resolve(override)];
  }
  const root = findPackageRoot();
  if (root === null) {
    return [];
  }
  return SKILL_DIR_NAMES.map((name) => join(root, name)).filter(isDirectory);
}

function findPackageRoot(): string | null {
  const here = fileURLToPath(import.meta.url);
  let dir = dirname(here);
  while (true) {
    for (const name of SKILL_DIR_NAMES) {
      if (isDirectory(join(dir, name))) {
        return dir;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

export function discoverSkills(dirs: readonly string[]): SkillInfo[] {
  const skills: SkillInfo[] = [];
  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch (error) {
      if (isNotFoundError(error)) {
        continue;
      }
      throw error;
    }
    for (const entryName of entries) {
      const skillDir = join(dir, entryName);
      const fm = readFrontmatterFromSkill(skillDir);
      if (fm === null) {
        continue;
      }
      skills.push({ name: fm.name, description: fm.description, hidden: fm.hidden, dir: skillDir });
    }
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

function readFrontmatterFromSkill(skillDir: string): Frontmatter | null {
  const skillMd = join(skillDir, SKILL_MD_FILENAME);
  const prefix = readFilePrefix(skillMd, FRONTMATTER_PREFIX_BYTES);
  if (prefix === null) {
    return null;
  }
  return parseFrontmatter(prefix);
}

function readFilePrefix(path: string, maxBytes: number): string | null {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
  try {
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = readSync(fd, buffer, 0, maxBytes, 0);
    return buffer.toString("utf8", 0, bytesRead);
  } finally {
    closeSync(fd);
  }
}

export function parseFrontmatter(content: string): Frontmatter | null {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith(FRONTMATTER_FENCE)) {
    return null;
  }
  const afterOpening = trimmed.slice(FRONTMATTER_FENCE.length);
  const closingIndex = afterOpening.indexOf(`\n${FRONTMATTER_FENCE}`);
  if (closingIndex < 0) {
    return null;
  }
  const block = afterOpening.slice(0, closingIndex);
  const result = parseYamlResult(block, Frontmatter);
  if (!result.ok) {
    return null;
  }
  return result.value;
}

export function readSkillContent(info: SkillInfo, opts: ReadSkillContentOptions): SkillContent {
  const body = readFileSync(join(info.dir, SKILL_MD_FILENAME), "utf8");
  if (!opts.includeExtras) {
    return {
      name: info.name,
      description: info.description,
      body,
      references: [],
      templates: [],
    };
  }
  return {
    name: info.name,
    description: info.description,
    body,
    references: collectExtraFiles(info.dir, SKILL_REFERENCES_DIR),
    templates: collectExtraFiles(info.dir, SKILL_TEMPLATES_DIR),
  };
}

function collectExtraFiles(skillDir: string, subdirName: string): SkillExtraFile[] {
  const subdir = join(skillDir, subdirName);
  if (!isDirectory(subdir)) {
    return [];
  }
  const entries = readdirSync(subdir).toSorted();
  const out: SkillExtraFile[] = [];
  for (const entry of entries) {
    const full = join(subdir, entry);
    if (!isFile(full)) {
      continue;
    }
    out.push({ path: `${subdirName}/${entry}`, content: readFileSync(full, "utf8") });
  }
  return out;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}
