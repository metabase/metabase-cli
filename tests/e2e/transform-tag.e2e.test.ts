import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DeleteResult } from "../../src/commands/delete-runtime";
import { TransformTagListEnvelope } from "../../src/commands/transform-tag/list";
import { TransformTagCompact } from "../../src/domain/transform-tag";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorMessage } from "./cli-error";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { requireServer } from "./server-gate";

const TAG_NAME = "e2e_tag";
const RENAMED = "e2e_tag_renamed";
const FIRST_USER_TAG_ID = 5;

const BUILT_IN_TAGS = [
  { id: 1, name: "hourly", built_in_type: "hourly" },
  { id: 2, name: "daily", built_in_type: "daily" },
  { id: 3, name: "weekly", built_in_type: "weekly" },
  { id: 4, name: "monthly", built_in_type: "monthly" },
] as const;

const USER_TAG_COMPACT = {
  id: FIRST_USER_TAG_ID,
  name: TAG_NAME,
  built_in_type: null,
} as const;

const skipReason = requireServer({ minVersion: 59 });

describe.skipIf(skipReason !== null)("transform-tag e2e", () => {
  let bootstrap: E2EBootstrap;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    bootstrap = await readBootstrap();
  });

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function makeIsolatedConfigHome(): Promise<string> {
    const dir = await mkTempConfigHome();
    tempDirs.push(dir);
    return dir;
  }

  function authEnv(): Record<string, string> {
    return {
      MB_URL: bootstrap.baseUrl,
      MB_API_KEY: bootstrap.adminApiKey,
    };
  }

  async function createSeedTag(name: string = TAG_NAME): Promise<TransformTagCompact> {
    const result = await runCli({
      args: ["transform-tag", "create", "--json"],
      stdin: JSON.stringify({ name }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    return parseJson(result.stdout, TransformTagCompact);
  }

  it("list returns the four built-in tags and the just-created user tag", async () => {
    const created = await createSeedTag();
    expect(created).toEqual(USER_TAG_COMPACT);

    const result = await runCli({
      args: ["transform-tag", "list", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const envelope = parseJson(result.stdout, TransformTagListEnvelope);
    const byId = [...envelope.data].toSorted((left, right) => left.id - right.id);
    expect(byId).toEqual([...BUILT_IN_TAGS, USER_TAG_COMPACT]);
    expect({ returned: envelope.returned, total: envelope.total }).toEqual({
      returned: BUILT_IN_TAGS.length + 1,
      total: BUILT_IN_TAGS.length + 1,
    });
  });

  it("update renames the tag and the change is visible via list", async () => {
    await createSeedTag();

    const updateResult = await runCli({
      args: ["transform-tag", "update", String(FIRST_USER_TAG_ID), "--json"],
      stdin: JSON.stringify({ name: RENAMED }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(updateResult.exitCode, updateResult.stderr).toBe(0);
    expect(parseJson(updateResult.stdout, TransformTagCompact)).toEqual({
      ...USER_TAG_COMPACT,
      name: RENAMED,
    });

    const listResult = await runCli({
      args: ["transform-tag", "list", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(listResult.exitCode, listResult.stderr).toBe(0);
    const envelope = parseJson(listResult.stdout, TransformTagListEnvelope);
    const userTag = envelope.data.find((tag) => tag.id === FIRST_USER_TAG_ID);
    expect(userTag).toEqual({ ...USER_TAG_COMPACT, name: RENAMED });
  });

  it("delete --yes removes the tag; subsequent list omits it", async () => {
    await createSeedTag();

    const deleteResult = await runCli({
      args: ["transform-tag", "delete", String(FIRST_USER_TAG_ID), "--yes", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(deleteResult.exitCode, deleteResult.stderr).toBe(0);
    expect(parseJson(deleteResult.stdout, DeleteResult)).toEqual({
      deleted: true,
      aborted: false,
      id: FIRST_USER_TAG_ID,
    });

    const listResult = await runCli({
      args: ["transform-tag", "list", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(listResult.exitCode, listResult.stderr).toBe(0);
    const envelope = parseJson(listResult.stdout, TransformTagListEnvelope);
    const byId = [...envelope.data].toSorted((left, right) => left.id - right.id);
    expect(byId).toEqual([...BUILT_IN_TAGS]);
  });

  it("create with body missing required name fails on Zod validation", async () => {
    const result = await runCli({
      args: ["transform-tag", "create", "--json"],
      stdin: JSON.stringify({}),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("request body: value did not match expected schema");
    expect(result.stdout).toBe("");
  });

  it("update with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["transform-tag", "update", "abc", "--json"],
      stdin: JSON.stringify({ name: RENAMED }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("update against a missing id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["transform-tag", "update", "9999999", "--json"],
      stdin: JSON.stringify({ name: RENAMED }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Not found: PUT /api/transform-tag/9999999.");
  });

  it("delete without --yes refuses in non-TTY and exits 2 (explicit confirmation required)", async () => {
    await createSeedTag();

    const result = await runCli({
      args: ["transform-tag", "delete", String(FIRST_USER_TAG_ID), "--json"],
      stdin: "",
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      `refusing to delete ${FIRST_USER_TAG_ID} without confirmation — pass --yes to proceed non-interactively`,
    );
    expect(result.stdout).toBe("");
  });
});
