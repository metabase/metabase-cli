import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorMessage } from "./cli-error";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { SEEDED } from "./seed/seeded";

const CSV_CONTENT = "id,name\n1,alice\n2,bob\n";
const MISSING_TABLE_ID = "9999999";

describe("upload e2e", () => {
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

  async function tempCsv(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "mb-upload-e2e-"));
    tempDirs.push(dir);
    const path = join(dir, "people.csv");
    await writeFile(path, CSV_CONTENT);
    return path;
  }

  function authEnv(): Record<string, string> {
    return {
      MB_URL: bootstrap.baseUrl,
      MB_API_KEY: bootstrap.adminApiKey,
    };
  }

  it("csv reaches the server and reports that uploads are not configured", async () => {
    const result = await runCli({
      args: ["upload", "csv", "--file", await tempCsv(), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(cliErrorMessage(result.stderr)).toBe("The uploads database is not configured.");
    expect(result.stdout).toBe("");
  });

  it("csv without a file fails fast with ConfigError before any request", async () => {
    const result = await runCli({
      args: ["upload", "csv", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(
      "provide the CSV file to upload with --file <path>",
    );
    expect(result.stdout).toBe("");
  });

  it("csv with a missing file path fails fast with ConfigError", async () => {
    const path = join(tmpdir(), "mb-upload-e2e-does-not-exist.csv");
    const result = await runCli({
      args: ["upload", "csv", "--file", path, "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(`--file not found: ${path}`);
    expect(result.stdout).toBe("");
  });

  it("csv rejects a non-integer --collection with ConfigError", async () => {
    const result = await runCli({
      args: ["upload", "csv", "--file", await tempCsv(), "--collection", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain(
      'invalid collection id: "abc" (expected integer)',
    );
    expect(result.stdout).toBe("");
  });

  it("append with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["upload", "append", "abc", "--file", await tempCsv(), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("append against a table not created by upload is rejected by the server", async () => {
    const result = await runCli({
      args: ["upload", "append", String(SEEDED.tables.orders), "--file", await tempCsv(), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(cliErrorMessage(result.stderr)).toBe("Uploads are not enabled.");
    expect(result.stdout).toBe("");
  });

  it("append against a missing table id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["upload", "append", MISSING_TABLE_ID, "--file", await tempCsv(), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`Not found: POST /api/table/${MISSING_TABLE_ID}/append-csv.`);
    expect(result.stdout).toBe("");
  });

  it("replace with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["upload", "replace", "abc", "--file", await tempCsv(), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });
});
