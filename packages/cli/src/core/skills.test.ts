import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConfigError, ValidationError } from "@metabase/client/errors";
import { FEATURE_NAMES } from "@metabase/client/version/features";
import type { ServerInfo } from "@metabase/client/version/probe";
import { createServerProfile, type ServerProfile } from "@metabase/client/version/profile";
import { ENV_SKILLS_DIR } from "./env";
import {
  availableSkillNames,
  discoverSkills,
  findSkillByName,
  loadAllSkills,
  parseFrontmatter,
  readSkillContent,
  resolveSections,
  resolveSkillDirs,
  selectForProfile,
  selectSkillsByNames,
  type SkillInfo,
} from "./skills";

function profileAt(
  major: number,
  tokenFeatures: ServerInfo["tokenFeatures"] = null,
): ServerProfile {
  return createServerProfile({
    edition: "oss",
    version: { tag: `v0.${major}.0`, major, patch: 0 },
    date: null,
    hash: null,
    tokenFeatures,
  });
}

describe("parseFrontmatter", () => {
  const SOURCE = "skills/x/SKILL.md";

  it("parses a minimal frontmatter block", () => {
    expect(
      parseFrontmatter("---\nname: test-skill\ndescription: A test skill.\n---\n\nBody.", SOURCE),
    ).toEqual({ name: "test-skill", description: "A test skill.", hidden: false, requires: [] });
  });

  it("throws ConfigError naming the file when there is no frontmatter delimiter", () => {
    expect(() => parseFrontmatter("# A skill\n\nNo frontmatter here.", SOURCE)).toThrow(
      new ConfigError("skills/x/SKILL.md: missing frontmatter"),
    );
  });

  it("throws ConfigError naming the file when the frontmatter is unterminated", () => {
    expect(() => parseFrontmatter("---\nname: foo\ndescription: bar\n", SOURCE)).toThrow(
      new ConfigError("skills/x/SKILL.md: unterminated frontmatter"),
    );
  });

  it("throws ValidationError naming the file when name is missing or empty", () => {
    for (const block of [
      "---\ndescription: no name\n---\n",
      "---\nname:\ndescription: blank\n---\n",
    ]) {
      expect(() => parseFrontmatter(block, SOURCE)).toThrow(ValidationError);
      expect(() => parseFrontmatter(block, SOURCE)).toThrow(
        "skills/x/SKILL.md: value did not match expected schema",
      );
    }
  });

  it("joins multi-line YAML description continuations", () => {
    expect(
      parseFrontmatter(
        "---\nname: multi\ndescription: First sentence.\n  Second line.\n  Third line.\n---\n",
        SOURCE,
      ),
    ).toEqual({
      name: "multi",
      description: "First sentence. Second line. Third line.",
      hidden: false,
      requires: [],
    });
  });

  it("parses hidden: true as hidden, missing or false as visible", () => {
    expect(parseFrontmatter("---\nname: a\ndescription: x\nhidden: true\n---\n", SOURCE)).toEqual({
      name: "a",
      description: "x",
      hidden: true,
      requires: [],
    });
    expect(parseFrontmatter("---\nname: b\ndescription: x\nhidden: false\n---\n", SOURCE)).toEqual({
      name: "b",
      description: "x",
      hidden: false,
      requires: [],
    });
    expect(parseFrontmatter("---\nname: c\ndescription: x\n---\n", SOURCE)).toEqual({
      name: "c",
      description: "x",
      hidden: false,
      requires: [],
    });
  });

  it("throws ConfigError naming the file on malformed YAML", () => {
    const unclosed = "---\nname: [unclosed\n---\n";
    expect(() => parseFrontmatter(unclosed, SOURCE)).toThrow(ConfigError);
    expect(() => parseFrontmatter(unclosed, SOURCE)).toThrow("skills/x/SKILL.md: invalid YAML: ");
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
  requires?: readonly string[];
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
  if (frontmatter.requires !== undefined) {
    lines.push(`requires: [${frontmatter.requires.join(", ")}]`);
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
      {
        name: "core",
        description: "Core.",
        hidden: false,
        requires: [],
        dir: join(temp.skillData, "core"),
      },
      {
        name: "metabase-cli",
        description: "Stub.",
        hidden: true,
        requires: [],
        dir: join(temp.skills, "metabase-cli"),
      },
      {
        name: "transform",
        description: "Transforms.",
        hidden: false,
        requires: [],
        dir: join(temp.skillData, "transform"),
      },
    ]);
  });

  it("skips a directory without a SKILL.md", () => {
    mkdirSync(join(temp.skillData, "empty"));
    writeSkill(temp.skillData, "real", { name: "real", description: "Real." }, "real body");

    expect(discoverSkills([temp.skillData])).toEqual([
      {
        name: "real",
        description: "Real.",
        hidden: false,
        requires: [],
        dir: join(temp.skillData, "real"),
      },
    ]);
  });

  it("throws ConfigError naming the file whose SKILL.md has no frontmatter rather than skipping it", () => {
    const noFmDir = join(temp.skillData, "no-frontmatter");
    mkdirSync(noFmDir);
    writeFileSync(join(noFmDir, "SKILL.md"), "# Plain markdown, no YAML.\n", "utf8");

    expect(() => discoverSkills([temp.skillData])).toThrow(
      new ConfigError(`${join(noFmDir, "SKILL.md")}: missing frontmatter`),
    );
  });

  it("returns an empty list when no skill directories exist", () => {
    expect(discoverSkills([join(temp.root, "missing-1"), join(temp.root, "missing-2")])).toEqual(
      [],
    );
  });

  it("reads `requires` as feature names", () => {
    writeSkill(
      temp.skillData,
      "transform",
      { name: "transform", description: "Transforms.", requires: ["transforms", "measures"] },
      "body",
    );

    expect(discoverSkills([temp.skillData])).toEqual([
      {
        name: "transform",
        description: "Transforms.",
        hidden: false,
        requires: ["transforms", "measures"],
        dir: join(temp.skillData, "transform"),
      },
    ]);
  });

  it("throws ConfigError naming an unknown feature in `requires` rather than skipping the skill", () => {
    writeSkill(
      temp.skillData,
      "typo",
      { name: "typo", description: "Typo.", requires: ["transforms", "transfroms"] },
      "body",
    );

    expect(() => discoverSkills([temp.skillData])).toThrow(
      new ConfigError(
        `skill typo: unknown feature in requires: transfroms (known: ${FEATURE_NAMES.join(", ")})`,
      ),
    );
  });
});

describe("resolveSections", () => {
  const TEXT = [
    "Intro.",
    "",
    "<!-- requires: transforms -->",
    "## Transforms",
    "",
    "Run one.",
    "<!-- /requires -->",
    "",
    "<!--requires: library,remoteSync-->",
    "Publish it.",
    "<!-- /requires -->",
    "",
    "Outro.",
  ].join("\n");

  it("returns the text as written, markers included, without features to resolve against", () => {
    expect(resolveSections(TEXT, null, "skill x")).toBe(TEXT);
  });

  it("keeps a met section without its markers and drops an unmet one with the blank line after it", () => {
    expect(resolveSections(TEXT, profileAt(61).features, "skill x")).toBe(
      ["Intro.", "", "## Transforms", "", "Run one.", "", "Outro."].join("\n"),
    );
  });

  it("needs every feature a section names", () => {
    const withLibraryOnly = profileAt(61, { library: true }).features;
    const withBoth = profileAt(61, { library: true, remote_sync: true }).features;

    expect(resolveSections(TEXT, withLibraryOnly, "skill x")).toBe(
      ["Intro.", "", "## Transforms", "", "Run one.", "", "Outro."].join("\n"),
    );
    expect(resolveSections(TEXT, withBoth, "skill x")).toBe(
      ["Intro.", "", "## Transforms", "", "Run one.", "", "Publish it.", "", "Outro."].join("\n"),
    );
  });

  it("drops every section on a server that has none of the features", () => {
    expect(resolveSections(TEXT, profileAt(58).features, "skill x")).toBe(
      ["Intro.", "", "Outro."].join("\n"),
    );
  });

  it("resolves markers the formatter surrounded with blank lines to single blank lines either way", () => {
    const text = [
      "A",
      "",
      "<!-- requires: transforms -->",
      "",
      "B",
      "",
      "<!-- /requires -->",
      "",
      "C",
    ].join("\n");

    expect(resolveSections(text, profileAt(61).features, "skill x")).toBe("A\n\nB\n\nC");
    expect(resolveSections(text, profileAt(58).features, "skill x")).toBe("A\n\nC");
  });

  it("keeps the single blank line between neighbours when a dropped section sat between them", () => {
    const text = ["A", "<!-- requires: transforms -->", "B", "<!-- /requires -->", "C"].join("\n");
    expect(resolveSections(text, profileAt(58).features, "skill x")).toBe("A\nC");
  });

  it("returns any text without a marker unchanged, whatever the features", () => {
    const plainLine = fc.string().filter((line) => !line.includes("<!--"));
    fc.assert(
      fc.property(
        fc.array(plainLine),
        fc.constantFrom(null, profileAt(58).features, profileAt(63).features),
        (lines, features) => {
          const text = lines.join("\n");
          expect(resolveSections(text, features, "skill x")).toBe(text);
        },
      ),
    );
  });

  it("returns balanced sections as written without features, and marker-free with them", () => {
    // Prose only: a table row against a marker is refused, and a fence would swallow the close.
    const plainLine = fc
      .string()
      .filter((line) => !line.includes("<!--") && line.trim() !== "")
      .filter((line) => !line.trimStart().startsWith("|"))
      .filter((line) => !line.trim().startsWith("```") && !line.trim().startsWith("~~~"));
    const section = fc
      .tuple(fc.constantFrom("transforms", "library"), fc.array(plainLine))
      .map(([feature, inner]) =>
        [`<!-- requires: ${feature} -->`].concat(inner, ["<!-- /requires -->"]),
      );
    const document = fc
      .array(fc.oneof(fc.array(plainLine, { maxLength: 3 }), section))
      .map((blocks) => blocks.flat().join("\n"));
    fc.assert(
      fc.property(document, (text) => {
        expect(resolveSections(text, null, "skill x")).toBe(text);
        const resolved = resolveSections(text, profileAt(61).features, "skill x");
        expect(resolved).not.toContain("<!-- requires");
        expect(resolved).not.toContain("<!-- /requires");
      }),
    );
  });

  it("throws ConfigError on a nested section", () => {
    const text = [
      "<!-- requires: transforms -->",
      "<!-- requires: measures -->",
      "<!-- /requires -->",
      "<!-- /requires -->",
    ].join("\n");
    expect(() => resolveSections(text, null, "skill x")).toThrow(
      new ConfigError("skill x: nested requires section at line 2 (opened at line 1)"),
    );
  });

  it("throws ConfigError on a close without an open", () => {
    expect(() => resolveSections("text\n<!-- /requires -->", null, "skill x")).toThrow(
      new ConfigError("skill x: requires section closed at line 2 was never opened"),
    );
  });

  it("throws ConfigError on an open that is never closed", () => {
    expect(() =>
      resolveSections("<!-- requires: transforms -->\ntext", profileAt(61).features, "skill x"),
    ).toThrow(new ConfigError("skill x: requires section opened at line 1 is never closed"));
  });

  it("throws ConfigError on a marker sharing a line with other text", () => {
    expect(() =>
      resolveSections(
        "Only <!-- requires: transforms --> here\n<!-- /requires -->",
        null,
        "skill x",
      ),
    ).toThrow(new ConfigError("skill x: a requires marker must be on its own line (line 1)"));
  });

  it("keeps a marker inside a fenced code block as text", () => {
    const text = [
      "Write it as:",
      "",
      "```md",
      "<!-- requires: transforms -->",
      "gated",
      "<!-- /requires -->",
      "```",
      "",
      "~~~",
      "<!-- requires: transforms -->",
      "~~~",
    ].join("\n");
    expect(resolveSections(text, profileAt(58).features, "skill x")).toBe(text);
  });

  it("throws ConfigError on a marker between table rows", () => {
    const text = [
      "| a |",
      "|---|",
      "<!-- requires: transforms -->",
      "| b |",
      "<!-- /requires -->",
    ].join("\n");
    expect(() => resolveSections(text, null, "skill x")).toThrow(
      new ConfigError("skill x: a requires marker cannot sit inside a Markdown table (line 3)"),
    );
  });

  it("throws ConfigError on a marker closed with the `--!>` comment end", () => {
    expect(() =>
      resolveSections("<!-- requires: transforms --!>\n<!-- /requires -->", null, "skill x"),
    ).toThrow(
      new ConfigError(
        "skill x: malformed requires marker at line 1 (expected `<!-- requires: a, b -->` or `<!-- /requires -->`)",
      ),
    );
  });

  it("throws ConfigError on a marker missing the colon after the keyword", () => {
    expect(() =>
      resolveSections("<!-- requires transforms -->\n<!-- /requires -->", null, "skill x"),
    ).toThrow(
      new ConfigError(
        "skill x: malformed requires marker at line 1 (expected `<!-- requires: a, b -->` or `<!-- /requires -->`)",
      ),
    );
  });

  it("throws ConfigError on a section naming no feature", () => {
    expect(() =>
      resolveSections("<!-- requires: -->\n<!-- /requires -->", null, "skill x"),
    ).toThrow(new ConfigError("skill x: requires section at line 1 names no feature"));
  });

  it("throws ConfigError on an unknown feature even when nothing is being resolved", () => {
    expect(() =>
      resolveSections("<!-- requires: transfroms -->\n<!-- /requires -->", null, "skill x"),
    ).toThrow(
      new ConfigError(
        `skill x line 1: unknown feature in requires: transfroms (known: ${FEATURE_NAMES.join(", ")})`,
      ),
    );
  });
});

describe("selectForProfile", () => {
  const skills: SkillInfo[] = [
    { name: "core", description: "Core.", hidden: false, requires: [], dir: "/x/core" },
    {
      name: "git-sync",
      description: "Sync.",
      hidden: false,
      requires: ["remoteSync"],
      dir: "/x/git-sync",
    },
    {
      name: "transform",
      description: "Transforms.",
      hidden: false,
      requires: ["transforms"],
      dir: "/x/transform",
    },
  ];

  it("filters nothing and reports `null` without a profile", () => {
    expect(selectForProfile(skills, null)).toEqual({ skills, unavailable: null });
  });

  it("sets aside each skill the profile lacks a feature for, with the client's own failure", () => {
    expect(selectForProfile(skills, profileAt(61))).toEqual({
      skills: [skills[0], skills[2]],
      unavailable: [
        {
          name: "git-sync",
          failure: {
            reason: "missing-token-feature",
            detail:
              "This operation requires the 'remote_sync' premium feature (not enabled on this server).",
            feature: "remoteSync",
            since: 60,
            tokenFeature: "remote_sync",
            serverVersion: "v0.61.0",
          },
        },
      ],
    });
  });

  it("reports an empty `unavailable` when the profile has every feature", () => {
    expect(selectForProfile(skills, profileAt(61, { remote_sync: true }))).toEqual({
      skills,
      unavailable: [],
    });
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
      requires: [],
      dir: skillDir,
    };

    expect(readSkillContent(info, { includeExtras: true, profile: null })).toEqual({
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
      requires: [],
      dir: skillDir,
    };

    expect(readSkillContent(info, { includeExtras: false, profile: null })).toEqual({
      name: "core",
      description: "Core skill.",
      body: "---\nname: core\ndescription: Core skill.\n---\n\nbody",
      references: [],
      templates: [],
    });
  });
});

describe("readSkillContent against a profile", () => {
  let temp: TempDirs;

  beforeEach(() => {
    temp = makeSkillsRoot();
  });

  afterEach(() => {
    rmSync(temp.root, { recursive: true, force: true });
  });

  it("resolves the sections of the body and of every reference, never of a template", () => {
    const skillDir = writeSkill(
      temp.skillData,
      "core",
      { name: "core", description: "Core skill." },
      "body\n<!-- requires: transforms -->\ngated\n<!-- /requires -->",
    );
    mkdirSync(join(skillDir, "references"));
    writeFileSync(
      join(skillDir, "references", "a.md"),
      "ref\n<!-- requires: transforms -->\ngated ref\n<!-- /requires -->",
      "utf8",
    );
    mkdirSync(join(skillDir, "templates"));
    writeFileSync(join(skillDir, "templates", "t.md"), "<!-- requires: transforms -->", "utf8");
    const info: SkillInfo = {
      name: "core",
      description: "Core skill.",
      hidden: false,
      requires: [],
      dir: skillDir,
    };

    expect(readSkillContent(info, { includeExtras: true, profile: profileAt(58) })).toEqual({
      name: "core",
      description: "Core skill.",
      body: "---\nname: core\ndescription: Core skill.\n---\n\nbody",
      references: [{ path: "references/a.md", content: "ref" }],
      templates: [{ path: "templates/t.md", content: "<!-- requires: transforms -->" }],
    });
  });

  it("names the reference file in a marker error", () => {
    const skillDir = writeSkill(
      temp.skillData,
      "core",
      { name: "core", description: "C." },
      "body",
    );
    mkdirSync(join(skillDir, "references"));
    writeFileSync(join(skillDir, "references", "a.md"), "<!-- /requires -->", "utf8");
    const info: SkillInfo = {
      name: "core",
      description: "C.",
      hidden: false,
      requires: [],
      dir: skillDir,
    };

    expect(() => readSkillContent(info, { includeExtras: true, profile: null })).toThrow(
      new ConfigError(
        "skill core (references/a.md): requires section closed at line 1 was never opened",
      ),
    );
  });
});

// The shipped skills are read here in full so a typo in a `requires` list or an unbalanced marker
// fails the gate instead of hiding a skill or a section from every user.
describe("the shipped skills", () => {
  it("declare exactly these skill-level requirements and carry only well-formed section markers", () => {
    const all = loadAllSkills();
    const bound = Object.fromEntries(
      all.filter((skill) => skill.requires.length > 0).map((skill) => [skill.name, skill.requires]),
    );

    expect(bound).toEqual({
      "git-sync": ["remoteSync"],
      rde: ["remoteSync", "transforms"],
      transform: ["transforms"],
    });
    const withMarkersLeft = all
      .filter((skill) => {
        const content = readSkillContent(skill, { includeExtras: true, profile: profileAt(58) });
        return content.body.includes("<!-- requires");
      })
      .map((skill) => skill.name);
    expect(all.map((skill) => skill.name)).toEqual([
      "core",
      "dashboard",
      "document",
      "git-sync",
      "mbql",
      "metabase-representation-format",
      "metadata",
      "native-sql",
      "rde",
      "transform",
      "visualization",
    ]);
    expect(withMarkersLeft).toEqual([]);
  });
});

describe("availableSkillNames", () => {
  it('formats the visible skill list as "available: a, b"', () => {
    const skills: SkillInfo[] = [
      { name: "core", description: "", hidden: false, requires: [], dir: "/x/core" },
      { name: "transform", description: "", hidden: false, requires: [], dir: "/x/transform" },
      { name: "metabase-cli", description: "", hidden: true, requires: [], dir: "/x/metabase-cli" },
    ];
    expect(availableSkillNames(skills)).toBe("available: core, transform");
  });

  it('falls back to "available: none" when no visible skills exist', () => {
    expect(availableSkillNames([])).toBe("available: none");
    expect(
      availableSkillNames([
        { name: "stub", description: "", hidden: true, requires: [], dir: "/x/stub" },
      ]),
    ).toBe("available: none");
  });
});

describe("findSkillByName", () => {
  const skills: SkillInfo[] = [
    { name: "core", description: "Core.", hidden: false, requires: [], dir: "/x/core" },
    {
      name: "transform",
      description: "Transforms.",
      hidden: false,
      requires: [],
      dir: "/x/transform",
    },
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
    { name: "core", description: "", hidden: false, requires: [], dir: "/x/core" },
    { name: "git-sync", description: "", hidden: false, requires: [], dir: "/x/git-sync" },
    { name: "transform", description: "", hidden: false, requires: [], dir: "/x/transform" },
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
  const originalEnv = process.env[ENV_SKILLS_DIR];

  beforeEach(() => {
    temp = makeSkillsRoot();
  });

  afterEach(() => {
    rmSync(temp.root, { recursive: true, force: true });
    if (originalEnv === undefined) {
      delete process.env[ENV_SKILLS_DIR];
    } else {
      process.env[ENV_SKILLS_DIR] = originalEnv;
    }
  });

  it("returns the env-var override directory when set", () => {
    process.env[ENV_SKILLS_DIR] = temp.skillData;
    expect(resolveSkillDirs()).toEqual([temp.skillData]);
  });

  it("throws ConfigError when the env-var override is not a directory", () => {
    process.env[ENV_SKILLS_DIR] = join(temp.root, "does-not-exist");
    expect(() => resolveSkillDirs()).toThrow(
      new ConfigError(
        `${ENV_SKILLS_DIR} points at ${join(temp.root, "does-not-exist")}, which is not a directory`,
      ),
    );
  });
});
