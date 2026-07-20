import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConfigError } from "./errors";
import {
  availableSkillNames,
  discoverSkills,
  findSkillByName,
  parseFrontmatter,
  readSkillContent,
  resolveSkillDirs,
  selectSkillsByNames,
  SKILLS_DIR_ENV,
  type SkillInfo,
} from "./skills";

describe("parseFrontmatter", () => {
  it("parses a minimal frontmatter block", () => {
    expect(
      parseFrontmatter("---\nname: test-skill\ndescription: A test skill.\n---\n\nBody."),
    ).toEqual({ name: "test-skill", description: "A test skill.", hidden: false });
  });

  it("returns null when there is no frontmatter delimiter", () => {
    expect(parseFrontmatter("# A skill\n\nNo frontmatter here.")).toBeNull();
  });

  it("returns null when the frontmatter is unterminated", () => {
    expect(parseFrontmatter("---\nname: foo\ndescription: bar\n")).toBeNull();
  });

  it("returns null when name is missing or empty", () => {
    expect(parseFrontmatter("---\ndescription: no name\n---\n")).toBeNull();
    expect(parseFrontmatter("---\nname:\ndescription: blank name\n---\n")).toBeNull();
  });

  it("joins multi-line YAML description continuations", () => {
    expect(
      parseFrontmatter(
        "---\nname: multi\ndescription: First sentence.\n  Second line.\n  Third line.\n---\n",
      ),
    ).toEqual({
      name: "multi",
      description: "First sentence. Second line. Third line.",
      hidden: false,
    });
  });

  it("parses hidden: true as hidden, missing or false as visible", () => {
    expect(parseFrontmatter("---\nname: a\ndescription: x\nhidden: true\n---\n")).toEqual({
      name: "a",
      description: "x",
      hidden: true,
    });
    expect(parseFrontmatter("---\nname: b\ndescription: x\nhidden: false\n---\n")).toEqual({
      name: "b",
      description: "x",
      hidden: false,
    });
    expect(parseFrontmatter("---\nname: c\ndescription: x\n---\n")).toEqual({
      name: "c",
      description: "x",
      hidden: false,
    });
  });

  it("returns null on malformed YAML", () => {
    expect(parseFrontmatter("---\n:::not yaml\n---\n")).toBeNull();
  });
});

interface TempDirs {
  root: string;
  skills: string;
  skillData: string;
}

function makeSkillsRoot(): TempDirs {
  const root = mkdtempSync(join(tmpdir(), "mb-skills-"));
  const skills = join(root, "skills");
  const skillData = join(root, "skill-data");
  mkdirSync(skills);
  mkdirSync(skillData);
  return { root, skills, skillData };
}

interface WriteSkillFrontmatter {
  name: string;
  description: string;
  hidden?: boolean;
}

function writeSkill(
  parent: string,
  dirName: string,
  frontmatter: WriteSkillFrontmatter,
  body: string,
): string {
  const dir = join(parent, dirName);
  mkdirSync(dir, { recursive: true });
  const lines = ["---", `name: ${frontmatter.name}`, `description: ${frontmatter.description}`];
  if (frontmatter.hidden === true) {
    lines.push("hidden: true");
  }
  lines.push("---", "", body);
  writeFileSync(join(dir, "SKILL.md"), lines.join("\n"), "utf8");
  return dir;
}

describe("discoverSkills", () => {
  let temp: TempDirs;

  beforeEach(() => {
    temp = makeSkillsRoot();
  });

  afterEach(() => {
    rmSync(temp.root, { recursive: true, force: true });
  });

  it("discovers skills from every directory and sorts by name", () => {
    writeSkill(
      temp.skills,
      "metabase-cli",
      { name: "metabase-cli", description: "Stub.", hidden: true },
      "stub body",
    );
    writeSkill(temp.skillData, "core", { name: "core", description: "Core." }, "core body");
    writeSkill(
      temp.skillData,
      "transform",
      { name: "transform", description: "Transforms." },
      "transform body",
    );

    expect(discoverSkills([temp.skills, temp.skillData])).toEqual([
      { name: "core", description: "Core.", hidden: false, dir: join(temp.skillData, "core") },
      {
        name: "metabase-cli",
        description: "Stub.",
        hidden: true,
        dir: join(temp.skills, "metabase-cli"),
      },
      {
        name: "transform",
        description: "Transforms.",
        hidden: false,
        dir: join(temp.skillData, "transform"),
      },
    ]);
  });

  it("skips directories without a SKILL.md and directories whose SKILL.md has no frontmatter", () => {
    mkdirSync(join(temp.skillData, "empty"));
    const noFmDir = join(temp.skillData, "no-frontmatter");
    mkdirSync(noFmDir);
    writeFileSync(join(noFmDir, "SKILL.md"), "# Plain markdown, no YAML.\n", "utf8");
    writeSkill(temp.skillData, "real", { name: "real", description: "Real." }, "real body");

    expect(discoverSkills([temp.skillData])).toEqual([
      { name: "real", description: "Real.", hidden: false, dir: join(temp.skillData, "real") },
    ]);
  });

  it("returns an empty list when no skill directories exist", () => {
    expect(discoverSkills([join(temp.root, "missing-1"), join(temp.root, "missing-2")])).toEqual(
      [],
    );
  });
});

describe("readSkillContent", () => {
  let temp: TempDirs;

  beforeEach(() => {
    temp = makeSkillsRoot();
  });

  afterEach(() => {
    rmSync(temp.root, { recursive: true, force: true });
  });

  it("returns body + references + templates when includeExtras is true", () => {
    const skillDir = writeSkill(
      temp.skillData,
      "core",
      { name: "core", description: "Core skill." },
      "main body content",
    );
    mkdirSync(join(skillDir, "references"));
    writeFileSync(join(skillDir, "references", "b.md"), "ref b", "utf8");
    writeFileSync(join(skillDir, "references", "a.md"), "ref a", "utf8");
    mkdirSync(join(skillDir, "templates"));
    writeFileSync(join(skillDir, "templates", "template.json"), '{"x":1}', "utf8");

    const info: SkillInfo = {
      name: "core",
      description: "Core skill.",
      hidden: false,
      dir: skillDir,
    };

    expect(readSkillContent(info, { includeExtras: true })).toEqual({
      name: "core",
      description: "Core skill.",
      body: "---\nname: core\ndescription: Core skill.\n---\n\nmain body content",
      references: [
        { path: "references/a.md", content: "ref a" },
        { path: "references/b.md", content: "ref b" },
      ],
      templates: [{ path: "templates/template.json", content: '{"x":1}' }],
    });
  });

  it("omits references and templates when includeExtras is false, even if files exist on disk", () => {
    const skillDir = writeSkill(
      temp.skillData,
      "core",
      { name: "core", description: "Core skill." },
      "body",
    );
    mkdirSync(join(skillDir, "references"));
    writeFileSync(join(skillDir, "references", "a.md"), "ref a", "utf8");

    const info: SkillInfo = {
      name: "core",
      description: "Core skill.",
      hidden: false,
      dir: skillDir,
    };

    expect(readSkillContent(info, { includeExtras: false })).toEqual({
      name: "core",
      description: "Core skill.",
      body: "---\nname: core\ndescription: Core skill.\n---\n\nbody",
      references: [],
      templates: [],
    });
  });
});

describe("availableSkillNames", () => {
  it('formats the visible skill list as "available: a, b"', () => {
    const skills: SkillInfo[] = [
      { name: "core", description: "", hidden: false, dir: "/x/core" },
      { name: "transform", description: "", hidden: false, dir: "/x/transform" },
      { name: "metabase-cli", description: "", hidden: true, dir: "/x/metabase-cli" },
    ];
    expect(availableSkillNames(skills)).toBe("available: core, transform");
  });

  it('falls back to "available: none" when no visible skills exist', () => {
    expect(availableSkillNames([])).toBe("available: none");
    expect(
      availableSkillNames([{ name: "stub", description: "", hidden: true, dir: "/x/stub" }]),
    ).toBe("available: none");
  });
});

describe("findSkillByName", () => {
  const skills: SkillInfo[] = [
    { name: "core", description: "Core.", hidden: false, dir: "/x/core" },
    { name: "transform", description: "Transforms.", hidden: false, dir: "/x/transform" },
  ];

  it("returns the matching skill", () => {
    expect(findSkillByName(skills, "core")).toEqual(skills[0]);
  });

  it("throws ConfigError with the available list when the name is unknown", () => {
    expect(() => findSkillByName(skills, "nope")).toThrow(
      new ConfigError("unknown skill name: nope (available: core, transform)"),
    );
  });
});

describe("selectSkillsByNames", () => {
  const skills: SkillInfo[] = [
    { name: "core", description: "", hidden: false, dir: "/x/core" },
    { name: "git-sync", description: "", hidden: false, dir: "/x/git-sync" },
    { name: "transform", description: "", hidden: false, dir: "/x/transform" },
  ];

  it("returns selected skills in the requested order", () => {
    expect(selectSkillsByNames(skills, ["git-sync", "core"])).toEqual([skills[1], skills[0]]);
  });

  it("throws ConfigError listing missing names and the available set", () => {
    expect(() => selectSkillsByNames(skills, ["core", "nope", "also-missing"])).toThrow(
      new ConfigError(
        "unknown skill name(s): nope, also-missing (available: core, git-sync, transform)",
      ),
    );
  });

  it("throws ConfigError when no names are requested", () => {
    expect(() => selectSkillsByNames(skills, [])).toThrow(
      new ConfigError("no skill names provided"),
    );
  });
});

describe("resolveSkillDirs", () => {
  let temp: TempDirs;
  const originalEnv = process.env[SKILLS_DIR_ENV];

  beforeEach(() => {
    temp = makeSkillsRoot();
  });

  afterEach(() => {
    rmSync(temp.root, { recursive: true, force: true });
    if (originalEnv === undefined) {
      delete process.env[SKILLS_DIR_ENV];
    } else {
      process.env[SKILLS_DIR_ENV] = originalEnv;
    }
  });

  it("returns the env-var override directory when set", () => {
    process.env[SKILLS_DIR_ENV] = temp.skillData;
    expect(resolveSkillDirs()).toEqual([temp.skillData]);
  });

  it("throws ConfigError when the env-var override is not a directory", () => {
    process.env[SKILLS_DIR_ENV] = join(temp.root, "does-not-exist");
    expect(() => resolveSkillDirs()).toThrow(
      new ConfigError(
        `${SKILLS_DIR_ENV} points at ${join(temp.root, "does-not-exist")}, which is not a directory`,
      ),
    );
  });
});
