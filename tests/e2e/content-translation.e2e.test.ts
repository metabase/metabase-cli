import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { ContentTranslationUploadResult } from "@metabase/client/domain/content-translation";
import { parseJson } from "@metabase/client/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorMessage } from "./cli-error";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { requireServer } from "./server-gate";

const CSV_CONTENT = "Language,String,Translation\nsv,Title,Rubrik\nar,Cat,قطة\n";
const REPLACEMENT_CSV_CONTENT = "Language,String,Translation\nde,Title,Titel\n";
const INVALID_LOCALE_CSV = "Language,String,Translation\nxx,Title,Rubrik\n";

const skipReason = requireServer(
  "content-translation › content translation e2e against EE endpoints",
  {
    minVersion: 58,
    tokenFeature: "content_translation",
  },
);

describe("content-translation arg validation e2e (no Metabase contact required)", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function makeIsolatedConfigHome(): Promise<string> {
    const dir = await mkTempConfigHome();
    tempDirs.push(dir);
    return dir;
  }

  it("upload without a file fails fast with ConfigError before any request", async () => {
    const result = await runCli({
      args: ["content-translation", "upload", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(
      "provide the CSV file to upload with --file <path>",
    );
    expect(result.stdout).toBe("");
  });

  it("upload with a missing file path fails fast with ConfigError", async () => {
    const path = join(tmpdir(), "mb-content-translation-does-not-exist.csv");
    const result = await runCli({
      args: ["content-translation", "upload", "--file", path, "--json"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(`--file not found: ${path}`);
    expect(result.stdout).toBe("");
  });
});

describe.skipIf(skipReason !== null)("content translation e2e against EE endpoints", () => {
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

  async function tempCsv(content: string = CSV_CONTENT): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "mb-content-translation-e2e-"));
    tempDirs.push(dir);
    const path = join(dir, "translations.csv");
    await writeFile(path, content);
    return path;
  }

  function authEnv(): Record<string, string> {
    return {
      MB_URL: bootstrap.baseUrl,
      MB_API_KEY: bootstrap.adminApiKey,
    };
  }

  it("download streams the server dictionary as CSV", async () => {
    const result = await runCli({
      args: ["content-translation", "download"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain("Locale Code,String,Translation");
    expect(result.stderr).toBe("");
  });

  it("upload replaces the dictionary and reports the server confirmation", async () => {
    const configHome = await makeIsolatedConfigHome();
    const upload = await runCli({
      args: ["content-translation", "upload", "--file", await tempCsv(), "--json"],
      configHome,
      env: authEnv(),
    });

    expect(upload.exitCode, upload.stderr).toBe(0);
    expect(parseJson(upload.stdout, ContentTranslationUploadResult)).toEqual({ success: true });

    const download = await runCli({
      args: ["content-translation", "download"],
      configHome,
      env: authEnv(),
    });
    expect(download.exitCode, download.stderr).toBe(0);
    expect(download.stdout).toContain("sv,Title,Rubrik");
    expect(download.stdout).toContain("ar,Cat,قطة");
  });

  it("a second upload replaces the previous dictionary rather than merging into it", async () => {
    const configHome = await makeIsolatedConfigHome();
    const first = await runCli({
      args: ["content-translation", "upload", "--file", await tempCsv(), "--json"],
      configHome,
      env: authEnv(),
    });
    expect(first.exitCode, first.stderr).toBe(0);

    const second = await runCli({
      args: [
        "content-translation",
        "upload",
        "--file",
        await tempCsv(REPLACEMENT_CSV_CONTENT),
        "--json",
      ],
      configHome,
      env: authEnv(),
    });
    expect(second.exitCode, second.stderr).toBe(0);

    const download = await runCli({
      args: ["content-translation", "download"],
      configHome,
      env: authEnv(),
    });
    expect(download.exitCode, download.stderr).toBe(0);
    expect(download.stdout).toContain("de,Title,Titel");
    expect(download.stdout).not.toContain("sv,Title,Rubrik");
  });

  it("upload of a dictionary with an unknown locale fails with the server's row error", async () => {
    const result = await runCli({
      args: [
        "content-translation",
        "upload",
        "--file",
        await tempCsv(INVALID_LOCALE_CSV),
        "--json",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(cliErrorMessage(result.stderr)).toBe("Row 2: Invalid locale: xx");
    expect(result.stdout).toBe("");
  });
});
