import { symlink } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConfigError, InternalError } from "@metabase/client/errors";

import { fileModesAt, filesContaining, mergeBase, readFilesAt, resolveCommit } from "./git";
import { type TempGitRepo, createTempGitRepo } from "./temp-git-repo";

let repo: TempGitRepo;

beforeEach(async () => {
  repo = await createTempGitRepo();
});

afterEach(async () => {
  await repo.remove();
});

describe("filesContaining", () => {
  it("lists the matching paths at a commit", async () => {
    await repo.put("t/a.yaml", "entity_id: abc\n");
    await repo.put("t/b.yml", "entity_id: xyz\n");
    const commit = await repo.commitAll("add");

    expect(await filesContaining(repo.path, commit, "entity_id: abc", ["*.yaml", "*.yml"])).toEqual(
      ["t/a.yaml"],
    );
  });

  it("answers no paths when nothing matches", async () => {
    const commit = await repo.git("rev-parse", "HEAD");

    expect(await filesContaining(repo.path, commit, "entity_id: none", ["*.yaml"])).toEqual([]);
  });

  it("is not confused by a color setting that forces escape codes into piped output", async () => {
    await repo.put("t/a.yaml", "entity_id: abc\n");
    const commit = await repo.commitAll("add");
    await repo.git("config", "color.ui", "always");
    await repo.git("config", "color.grep", "always");

    expect(await filesContaining(repo.path, commit, "entity_id: abc", ["*.yaml"])).toEqual([
      "t/a.yaml",
    ]);
  });
});

describe("resolveCommit", () => {
  it("names the flag and ref that do not resolve", async () => {
    const resolve = resolveCommit(repo.path, "nope", "--base");

    await expect(resolve).rejects.toThrow(ConfigError);
    await expect(resolve).rejects.toThrow(`--base nope is not a commit in ${repo.path}`);
  });
});

describe("mergeBase", () => {
  it("explains histories with no common ancestor", async () => {
    const main = await repo.git("rev-parse", "HEAD");
    await repo.git("checkout", "-q", "--orphan", "unrelated");
    const orphan = await repo.commitAll("unrelated root");
    const find = mergeBase(repo.path, main, orphan);

    await expect(find).rejects.toThrow(ConfigError);
    await expect(find).rejects.toThrow("the clone may be shallow (fetch the full history");
  });
});

describe("fileModesAt", () => {
  it("names the git mode of every file at a commit, symlinks included", async () => {
    await repo.put("t/a.yaml", "name: a\n");
    await symlink("a.yaml", join(repo.path, "t/link.yaml"));
    const commit = await repo.commitAll("add");

    expect(await fileModesAt(repo.path, commit)).toEqual(
      new Map([
        ["README.md", "100644"],
        ["t/a.yaml", "100644"],
        ["t/link.yaml", "120000"],
      ]),
    );
  });
});

describe("readFilesAt", () => {
  it("reads many files in one batch, framing each by its byte size", async () => {
    await repo.put("t/a.yaml", "name: Café ☕ résumé\n");
    await repo.put("t/b.yaml", "name: plain\n");
    await repo.put("t/c.yaml", "");
    const commit = await repo.commitAll("add");

    expect(await readFilesAt(repo.path, commit, ["t/a.yaml", "t/b.yaml", "t/c.yaml"])).toEqual(
      new Map([
        ["t/a.yaml", "name: Café ☕ résumé\n"],
        ["t/b.yaml", "name: plain\n"],
        ["t/c.yaml", ""],
      ]),
    );
  });

  it("reads nothing when asked for nothing", async () => {
    const commit = await repo.git("rev-parse", "HEAD");

    expect(await readFilesAt(repo.path, commit, [])).toEqual(new Map());
  });

  it("refuses a path that is not a file at the commit", async () => {
    const commit = await repo.git("rev-parse", "HEAD");
    const read = readFilesAt(repo.path, commit, ["README.md", "missing.yaml"]);

    await expect(read).rejects.toThrow(InternalError);
    await expect(read).rejects.toThrow(
      `missing.yaml is not a file at ${commit}, though git listed it there`,
    );
  });
});
