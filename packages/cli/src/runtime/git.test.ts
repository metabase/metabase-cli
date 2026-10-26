import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConfigError } from "@metabase/client/errors";

import { filesContaining, mergeBase, readFileAt, resolveCommit } from "./git";
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

  it("is not confused by a colour setting that forces escape codes into piped output", async () => {
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

describe("readFileAt", () => {
  it("refuses a path that is not in the commit", async () => {
    const commit = await repo.git("rev-parse", "HEAD");
    const read = readFileAt(repo.path, commit, "missing.yaml");

    await expect(read).rejects.toThrow(ConfigError);
    await expect(read).rejects.toThrow(
      `git cat-file blob ${commit}:missing.yaml failed in ${repo.path}`,
    );
  });
});
