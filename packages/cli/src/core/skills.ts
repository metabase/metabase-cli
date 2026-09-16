import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { ConfigError, isFileNotFoundError } from "@metabase/client/errors";
import {
  FEATURE_NAMES,
  type FeatureName,
  type Features,
  isFeatureName,
} from "@metabase/client/version/features";
import type { RequirementFailure } from "@metabase/client/version/preflight-error";
import type { ServerProfile } from "@metabase/client/version/profile";
import { checkFeatures } from "@metabase/client/version/requirement-check";

import { parseCsv } from "../runtime/csv";
import { parseYaml } from "../runtime/yaml";
import { ENV_SKILLS_DIR, readEnv } from "./env";

const Frontmatter = z
  .object({
    name: z.string().min(1),
    description: z.string().default(""),
    hidden: z.boolean().default(false),
    requires: z.array(z.string()).default([]),
  })
  .loose();
type Frontmatter = z.infer<typeof Frontmatter>;

const SkillExtraFile = z.object({
  path: z.string(),
  content: z.string(),
});
type SkillExtraFile = z.infer<typeof SkillExtraFile>;

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
  requires: FeatureName[];
  dir: string;
}

// A skill the connected server cannot use, with the client's own account of the first feature it
// lacks — the same refusal the skill's commands would meet.
export interface UnavailableSkill {
  name: string;
  failure: RequirementFailure;
}

// `unavailable` is `null` when nothing was filtered out because there was no server to filter by.
export interface SkillSelection {
  skills: SkillInfo[];
  unavailable: UnavailableSkill[] | null;
}

interface ReadSkillContentOptions {
  includeExtras: boolean;
  profile: ServerProfile | null;
}

const SKILL_DIR_NAMES = ["skills", "skill-data"] as const;
export const SKILL_MD_FILENAME = "SKILL.md";
const SKILL_REFERENCES_DIR = "references";
const SKILL_TEMPLATES_DIR = "templates";

const FRONTMATTER_PREFIX_BYTES = 8192;
const FRONTMATTER_FENCE = "---";

const SECTION_OPEN_PREFIX = /^<!--\s*requires:\s*/;
const MARKER_END = /\s*-->$/;
const SECTION_OPEN = /^<!--\s*requires:.*-->$/;
const SECTION_CLOSE = /^<!--\s*\/requires\s*-->$/;
const SECTION_MARKER_TEXT = /<!--\s*\/?requires\b/;

export function loadAllSkills(): SkillInfo[] {
  return discoverSkills(resolveSkillDirs());
}

export function loadVisibleSkills(): SkillInfo[] {
  return loadAllSkills().filter((s) => !s.hidden);
}

export function selectForProfile(
  skills: readonly SkillInfo[],
  profile: ServerProfile | null,
): SkillSelection {
  if (profile === null) {
    return { skills: [...skills], unavailable: null };
  }
  const available: SkillInfo[] = [];
  const unavailable: UnavailableSkill[] = [];
  for (const skill of skills) {
    const failure = checkFeatures(skill.requires, profile);
    if (failure === null) {
      available.push(skill);
    } else {
      unavailable.push({ name: skill.name, failure });
    }
  }
  return { skills: available, unavailable };
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
  const override = readEnv(ENV_SKILLS_DIR);
  if (override !== undefined && override !== "") {
    if (!isDirectory(override)) {
      throw new ConfigError(`${ENV_SKILLS_DIR} points at ${override}, which is not a directory`);
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
      if (isFileNotFoundError(error)) {
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
      skills.push({
        name: fm.name,
        description: fm.description,
        hidden: fm.hidden,
        requires: parseFeatureNames(fm.requires, `skill ${fm.name}`),
        dir: skillDir,
      });
    }
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

// `null` only when there is no SKILL.md, so a stray entry in a skills directory is not a skill. A
// SKILL.md that is there but malformed is a broken skill, and a broken skill refuses rather than
// vanishing from the list.
function readFrontmatterFromSkill(skillDir: string): Frontmatter | null {
  const skillMd = join(skillDir, SKILL_MD_FILENAME);
  const prefix = readFilePrefix(skillMd, FRONTMATTER_PREFIX_BYTES);
  if (prefix === null) {
    return null;
  }
  return parseFrontmatter(prefix, skillMd);
}

function readFilePrefix(path: string, maxBytes: number): string | null {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch (error) {
    if (isFileNotFoundError(error)) {
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

export function parseFrontmatter(content: string, source: string): Frontmatter {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith(FRONTMATTER_FENCE)) {
    throw new ConfigError(`${source}: missing frontmatter`);
  }
  const afterOpening = trimmed.slice(FRONTMATTER_FENCE.length);
  const closingIndex = afterOpening.indexOf(`\n${FRONTMATTER_FENCE}`);
  if (closingIndex < 0) {
    throw new ConfigError(`${source}: unterminated frontmatter`);
  }
  return parseYaml(afterOpening.slice(0, closingIndex), Frontmatter, { source });
}

export function readSkillContent(info: SkillInfo, opts: ReadSkillContentOptions): SkillContent {
  const features = opts.profile === null ? null : opts.profile.features;
  const raw = readFileSync(join(info.dir, SKILL_MD_FILENAME), "utf8");
  const body = resolveSections(raw, features, `skill ${info.name}`);
  if (!opts.includeExtras) {
    return {
      name: info.name,
      description: info.description,
      body,
      references: [],
      templates: [],
    };
  }
  const references = collectExtraFiles(info.dir, SKILL_REFERENCES_DIR).map((file) => ({
    path: file.path,
    content: resolveSections(file.content, features, `skill ${info.name} (${file.path})`),
  }));
  return {
    name: info.name,
    description: info.description,
    body,
    references,
    templates: collectExtraFiles(info.dir, SKILL_TEMPLATES_DIR),
  };
}

function parseFeatureNames(names: readonly string[], where: string): FeatureName[] {
  const known: FeatureName[] = [];
  const unknown: string[] = [];
  for (const name of names) {
    if (isFeatureName(name)) {
      known.push(name);
    } else {
      unknown.push(name);
    }
  }
  if (unknown.length > 0) {
    throw new ConfigError(
      `${where}: unknown feature in requires: ${unknown.join(", ")} (known: ${FEATURE_NAMES.join(", ")})`,
    );
  }
  return known;
}

interface OpenSection {
  line: number;
  met: boolean;
}

// Without features the markers stay in the text, so a reader still sees what each section needs.
// They are validated either way, so a typo fails on every read rather than only against some server.
export function resolveSections(text: string, features: Features | null, where: string): string {
  const out: string[] = [];
  let open: OpenSection | null = null;
  let collapseBlank = false;
  for (const [index, line] of text.split("\n").entries()) {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (SECTION_OPEN.test(trimmed)) {
      if (open !== null) {
        throw new ConfigError(
          `${where}: nested requires section at line ${lineNumber} (opened at line ${open.line})`,
        );
      }
      const named = parseFeatureNames(sectionFeatureNames(trimmed), `${where} line ${lineNumber}`);
      if (named.length === 0) {
        throw new ConfigError(`${where}: requires section at line ${lineNumber} names no feature`);
      }
      open = { line: lineNumber, met: features === null || named.every((name) => features[name]) };
      collapseBlank = dropMarker(out, line, features);
      continue;
    }
    if (SECTION_CLOSE.test(trimmed)) {
      if (open === null) {
        throw new ConfigError(
          `${where}: requires section closed at line ${lineNumber} was never opened`,
        );
      }
      collapseBlank = dropMarker(out, line, features);
      open = null;
      continue;
    }
    if (SECTION_MARKER_TEXT.test(line)) {
      throw new ConfigError(
        `${where}: a requires marker must be on its own line (line ${lineNumber})`,
      );
    }
    if (collapseBlank) {
      collapseBlank = false;
      if (trimmed === "") {
        continue;
      }
    }
    if (open === null || open.met) {
      out.push(line);
    }
  }
  if (open !== null) {
    throw new ConfigError(`${where}: requires section opened at line ${open.line} is never closed`);
  }
  return out.join("\n");
}

// Whether a blank line after a dropped marker would only double a blank line already kept.
function dropMarker(out: string[], marker: string, features: Features | null): boolean {
  if (features === null) {
    out.push(marker);
    return false;
  }
  return out.length === 0 || out[out.length - 1] === "";
}

function sectionFeatureNames(marker: string): string[] {
  return parseCsv(marker.replace(SECTION_OPEN_PREFIX, "").replace(MARKER_END, ""));
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
    if (isFileNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}
