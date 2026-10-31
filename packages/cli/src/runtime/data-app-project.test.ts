import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, assert, beforeEach, describe, expect, it } from "vitest";

import { ConfigError } from "@metabase/client/errors";

import { findSkillByName, loadAllSkills } from "../core/skills";
import { ignoreLocalEnv, scaffoldDataAppProject, writeProjectFile } from "./data-app-project";

const TEMPLATE_DIR = join(findSkillByName(loadAllSkills(), "data-app").dir, "template");
const TEMPLATE_PACKAGE_NAME = '"name": "data-app-template"';

function templatePackageNamed(name: string): string {
  return readFileSync(join(TEMPLATE_DIR, "package.json"), "utf8").replace(
    TEMPLATE_PACKAGE_NAME,
    `"name": "${name}"`,
  );
}

async function scaffoldError(dir: string): Promise<unknown> {
  return scaffoldDataAppProject({ dir, templateDir: TEMPLATE_DIR }).catch(
    (caught: unknown) => caught,
  );
}

describe("data app project files", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mb-data-app-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("scaffolds into a missing directory, restoring .gitignore and naming the package after it", async () => {
    const dir = join(tempDir, "sales-overview");

    await scaffoldDataAppProject({ dir, templateDir: TEMPLATE_DIR });

    const templateEntries = readdirSync(TEMPLATE_DIR).map((entry) =>
      entry === "gitignore" ? ".gitignore" : entry,
    );
    expect(readdirSync(dir).toSorted()).toEqual(templateEntries.toSorted());
    expect(readFileSync(join(dir, "package.json"), "utf8")).toBe(
      templatePackageNamed("sales-overview"),
    );
  });

  it("adds .env.local to a missing .gitignore, then to one without it, once", async () => {
    const gitignore = join(tempDir, ".gitignore");

    await ignoreLocalEnv(gitignore);
    expect(readFileSync(gitignore, "utf8")).toBe(".env.local\n");

    writeFileSync(gitignore, "node_modules", "utf8");
    await ignoreLocalEnv(gitignore);
    await ignoreLocalEnv(gitignore);
    expect(readFileSync(gitignore, "utf8")).toBe("node_modules\n.env.local\n");
  });

  it("scaffolds into an empty directory", async () => {
    const dir = join(tempDir, "empty");
    mkdirSync(dir);

    await scaffoldDataAppProject({ dir, templateDir: TEMPLATE_DIR });

    expect(readFileSync(join(dir, "package.json"), "utf8")).toBe(templatePackageNamed("empty"));
  });

  it("derives a valid npm package name from the directory name", async () => {
    const dir = join(tempDir, "_My Sales App!");

    await scaffoldDataAppProject({ dir, templateDir: TEMPLATE_DIR });

    expect(readFileSync(join(dir, "package.json"), "utf8")).toBe(
      templatePackageNamed("my-sales-app"),
    );
  });

  it("refuses a directory that isn't empty and leaves it untouched", async () => {
    writeFileSync(join(tempDir, "notes.txt"), "keep", "utf8");

    const error = await scaffoldError(tempDir);

    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toBe(`${tempDir} is not empty — scaffold into a new or empty directory`);
    expect(readdirSync(tempDir)).toEqual(["notes.txt"]);
  });

  it("refuses a target that is a file", async () => {
    const file = join(tempDir, "app");
    writeFileSync(file, "", "utf8");

    const error = await scaffoldError(file);

    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toBe(
      `${file} is not a directory — scaffold into a new or empty directory`,
    );
  });

  it("refuses a directory whose name yields no package name", async () => {
    const dir = join(tempDir, "___");

    const error = await scaffoldError(dir);

    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toBe(
      `cannot name the package after ${dir} — scaffold into a directory whose name has a letter or a digit`,
    );
  });

  it("writes a project file, creating its parent directories", async () => {
    const path = join(tempDir, "src", "generated", "metabase.ts");

    await writeProjectFile(path, "export const queries = {};\n");

    expect(readFileSync(path, "utf8")).toBe("export const queries = {};\n");
  });
});
