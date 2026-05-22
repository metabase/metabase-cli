import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import packageJson from "../../package.json" with { type: "json" };
import { UpgradeStatus } from "../../src/commands/upgrade";
import { parseJson } from "../../src/runtime/json";

import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";

interface RegistryFixture {
  url: string;
  setDistTags: (tags: Record<string, string>) => void;
  setStatus: (status: number, body?: string) => void;
  reset: () => void;
}

function startRegistryFixture(): Promise<{ fixture: RegistryFixture; close: () => Promise<void> }> {
  let distTags: Record<string, string> = { latest: packageJson.version };
  let status = 200;
  let body: string | null = null;

  const server: Server = createServer((_req, res) => {
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(body ?? JSON.stringify(distTags));
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("server.address() did not return AddressInfo"));
        return;
      }
      const info: AddressInfo = address;
      const url = `http://127.0.0.1:${info.port}`;
      const fixture: RegistryFixture = {
        url,
        setDistTags: (tags) => {
          distTags = tags;
          body = null;
          status = 200;
        },
        setStatus: (next, nextBody) => {
          status = next;
          body = nextBody ?? null;
        },
        reset: () => {
          distTags = { latest: packageJson.version };
          body = null;
          status = 200;
        },
      };
      resolve({
        fixture,
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.close((error) => {
              if (error) {
                rejectClose(error);
                return;
              }
              resolveClose();
            });
          }),
      });
    });
  });
}

describe("upgrade e2e", () => {
  let fixture: RegistryFixture;
  let closeFixture: () => Promise<void>;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    const handle = await startRegistryFixture();
    fixture = handle.fixture;
    closeFixture = handle.close;
  });

  afterAll(async () => {
    await closeFixture();
  });

  afterEach(async () => {
    fixture.reset();
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function makeIsolatedConfigHome(): Promise<string> {
    const dir = await mkTempConfigHome();
    tempDirs.push(dir);
    return dir;
  }

  it("--check --json reports up-to-date when the registry matches the bundled version", async () => {
    fixture.setDistTags({ latest: packageJson.version });
    const result = await runCli({
      args: ["upgrade", "--check", "--json", "--registry", fixture.url],
      configHome: await makeIsolatedConfigHome(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, UpgradeStatus)).toEqual({
      packageName: packageJson.name,
      currentVersion: packageJson.version,
      latestVersion: packageJson.version,
      targetVersion: packageJson.version,
      updateAvailable: false,
      changeRequired: false,
      installMethod: "dev",
      packageManager: "unknown",
      binaryPath: expect.stringMatching(/cli\.mjs$/),
      command: null,
      canAutoInstall: false,
    });
  });

  it("--check --json reports updateAvailable=true when the registry advertises a newer version", async () => {
    fixture.setDistTags({ latest: "999.0.0" });
    const result = await runCli({
      args: ["upgrade", "--check", "--json", "--registry", fixture.url],
      configHome: await makeIsolatedConfigHome(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, UpgradeStatus)).toEqual({
      packageName: packageJson.name,
      currentVersion: packageJson.version,
      latestVersion: "999.0.0",
      targetVersion: "999.0.0",
      updateAvailable: true,
      changeRequired: true,
      installMethod: "dev",
      packageManager: "unknown",
      binaryPath: expect.stringMatching(/cli\.mjs$/),
      command: null,
      canAutoInstall: false,
    });
  });

  it("--to <older> --check reports changeRequired but updateAvailable=false", async () => {
    fixture.setDistTags({ latest: packageJson.version });
    const result = await runCli({
      args: ["upgrade", "--check", "--json", "--registry", fixture.url, "--to", "0.0.1"],
      configHome: await makeIsolatedConfigHome(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, UpgradeStatus)).toEqual({
      packageName: packageJson.name,
      currentVersion: packageJson.version,
      latestVersion: packageJson.version,
      targetVersion: "0.0.1",
      updateAvailable: false,
      changeRequired: true,
      installMethod: "dev",
      packageManager: "unknown",
      binaryPath: expect.stringMatching(/cli\.mjs$/),
      command: null,
      canAutoInstall: false,
    });
  });

  it("--to <invalid> exits 2 with the ZodError message", async () => {
    const result = await runCli({
      args: ["upgrade", "--check", "--json", "--registry", fixture.url, "--to", "not-a-version"],
      configHome: await makeIsolatedConfigHome(),
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("expected semver MAJOR.MINOR.PATCH[-prerelease][+build]");
    expect(result.stdout).toBe("");
  });

  it("registry HTTP 500 surfaces as exit 1 with the HttpError message", async () => {
    fixture.setStatus(500, JSON.stringify({ error: "registry exploded" }));
    const result = await runCli({
      args: ["upgrade", "--check", "--json", "--registry", fixture.url],
      configHome: await makeIsolatedConfigHome(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("registry exploded");
  });

  it("default (text, TTY off) renders prose and includes the latest version", async () => {
    fixture.setDistTags({ latest: "999.0.0" });
    const result = await runCli({
      args: ["upgrade", "--check", "--format", "text", "--registry", fixture.url],
      configHome: await makeIsolatedConfigHome(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain(`Update available: ${packageJson.version} → 999.0.0`);
    expect(result.stdout).toContain("Running from source");
  });
});
