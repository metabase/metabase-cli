import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { SnippetListEnvelope } from "../../src/commands/snippet/list";
import { Snippet, SnippetCompact, type SnippetCreateInput } from "../../src/domain/snippet";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";

const FIRST_NEW_SNIPPET_ID = 1;
const SNIPPET_NAME = "active_filter";
const SNIPPET_CONTENT = "WHERE active = true";
const SNIPPET_DESCRIPTION = "Restrict to currently active rows.";

const NEW_SNIPPET_COMPACT = {
  id: FIRST_NEW_SNIPPET_ID,
  name: SNIPPET_NAME,
  description: SNIPPET_DESCRIPTION,
  archived: false,
  collection_id: null,
} as const;

const NEW_SNIPPET_BODY: SnippetCreateInput = {
  name: SNIPPET_NAME,
  content: SNIPPET_CONTENT,
  description: SNIPPET_DESCRIPTION,
};

describe("snippet e2e", () => {
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
      METABASE_URL: bootstrap.baseUrl,
      METABASE_API_KEY: bootstrap.adminApiKey,
    };
  }

  async function createSnippet(): Promise<void> {
    const result = await runCli({
      args: ["snippet", "create", "--json"],
      stdin: JSON.stringify(NEW_SNIPPET_BODY),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
  }

  it("list returns an empty envelope on a fresh restore", async () => {
    const result = await runCli({
      args: ["snippet", "list", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, SnippetListEnvelope)).toEqual({
      data: [],
      returned: 0,
      total: 0,
    });
  });

  it("create returns the hydrated snippet in compact form by default", async () => {
    const result = await runCli({
      args: ["snippet", "create", "--json"],
      stdin: JSON.stringify(NEW_SNIPPET_BODY),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, SnippetCompact)).toEqual(NEW_SNIPPET_COMPACT);
  });

  it("create + list shows the new snippet via the compact projection", async () => {
    await createSnippet();

    const listResult = await runCli({
      args: ["snippet", "list", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(listResult.exitCode, listResult.stderr).toBe(0);
    expect(parseJson(listResult.stdout, SnippetListEnvelope)).toEqual({
      data: [NEW_SNIPPET_COMPACT],
      returned: 1,
      total: 1,
    });
  });

  it("create with a body missing required fields fails on Zod validation", async () => {
    const result = await runCli({
      args: ["snippet", "create", "--json"],
      stdin: JSON.stringify({ name: "missing-content" }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("request body: value did not match expected schema");
    expect(result.stdout).toBe("");
  });

  it("get returns the snippet by id in compact form", async () => {
    await createSnippet();

    const result = await runCli({
      args: ["snippet", "get", String(FIRST_NEW_SNIPPET_ID), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, SnippetCompact)).toEqual(NEW_SNIPPET_COMPACT);
  });

  it("get --full surfaces the content field stripped from the compact view", async () => {
    await createSnippet();

    const result = await runCli({
      args: ["snippet", "get", String(FIRST_NEW_SNIPPET_ID), "--full", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, Snippet).content).toBe(SNIPPET_CONTENT);
  });

  it("get with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["snippet", "get", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("get against a missing snippet id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["snippet", "get", "9999999", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Not found: GET /api/native-query-snippet/9999999.");
  });

  it("update renames the snippet and the compact view reflects the new name", async () => {
    await createSnippet();

    const result = await runCli({
      args: ["snippet", "update", String(FIRST_NEW_SNIPPET_ID), "--json"],
      stdin: JSON.stringify({ name: "active_filter_renamed" }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, SnippetCompact)).toEqual({
      ...NEW_SNIPPET_COMPACT,
      name: "active_filter_renamed",
    });
  });

  it("update with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["snippet", "update", "abc", "--json"],
      stdin: JSON.stringify({ name: "x" }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("archive flips archived from false to true and list excludes it by default", async () => {
    await createSnippet();

    const archiveResult = await runCli({
      args: ["snippet", "archive", String(FIRST_NEW_SNIPPET_ID), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(archiveResult.exitCode, archiveResult.stderr).toBe(0);
    expect(parseJson(archiveResult.stdout, SnippetCompact)).toEqual({
      ...NEW_SNIPPET_COMPACT,
      archived: true,
    });

    const listResult = await runCli({
      args: ["snippet", "list", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(listResult.exitCode, listResult.stderr).toBe(0);
    expect(parseJson(listResult.stdout, SnippetListEnvelope)).toEqual({
      data: [],
      returned: 0,
      total: 0,
    });
  });

  it("list --archived returns the archived snippet and excludes the active one", async () => {
    await createSnippet();
    const archiveResult = await runCli({
      args: ["snippet", "archive", String(FIRST_NEW_SNIPPET_ID), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(archiveResult.exitCode, archiveResult.stderr).toBe(0);

    const listResult = await runCli({
      args: ["snippet", "list", "--archived", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(listResult.exitCode, listResult.stderr).toBe(0);
    expect(parseJson(listResult.stdout, SnippetListEnvelope)).toEqual({
      data: [{ ...NEW_SNIPPET_COMPACT, archived: true }],
      returned: 1,
      total: 1,
    });
  });

  it("archive with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["snippet", "archive", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });
});
