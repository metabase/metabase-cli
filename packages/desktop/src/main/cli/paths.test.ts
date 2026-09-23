import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCommand } from "../process/spawn";

import { cliEnvironment, cliLocation } from "./paths";

const NEVER_ABORTED = new AbortController().signal;
const SHIM_TIMEOUT_MS = 10_000;
const SHIM_OUTPUT_LIMIT_BYTES = 4096;
const DESKTOP_ROOT = resolve(import.meta.dirname, "..", "..", "..");
const SHIM = join(DESKTOP_ROOT, "resources", "rde-cli", "bin", "mb");

const ECHO_SCRIPT = `process.stdout.write(JSON.stringify({ args: process.argv.slice(2), runAsNode: process.env.ELECTRON_RUN_AS_NODE }));`;

const cleanups: string[] = [];

afterEach(async () => {
  for (const path of cleanups.splice(0)) {
    await rm(path, { recursive: true, force: true });
  }
});

describe("cliLocation", () => {
  it("finds the workspace's built CLI, its skills and the shim beside the dev build", () => {
    expect(
      cliLocation({ kind: "dev", outDir: "/repo/packages/desktop/out" }, "/bin/electron"),
    ).toEqual({
      node: "/bin/electron",
      entry: "/repo/packages/cli/dist/cli.mjs",
      skills: "/repo/packages/cli/skill-data",
      bin: "/repo/packages/desktop/resources/rde-cli/bin",
    });
  });

  it("finds all three under the packaged app's resources", () => {
    expect(
      cliLocation({ kind: "packaged", resourcesPath: "/opt/rde/resources" }, "/opt/rde/rde"),
    ).toEqual({
      node: "/opt/rde/rde",
      entry: "/opt/rde/resources/rde-cli/dist/cli.mjs",
      skills: "/opt/rde/resources/rde-cli/skill-data",
      bin: "/opt/rde/resources/rde-cli/bin",
    });
  });
});

describe("cliEnvironment", () => {
  it("puts the shim first on PATH and names the Node, the CLI and the skills", () => {
    const location = cliLocation({ kind: "packaged", resourcesPath: "/r" }, "/app");
    expect(cliEnvironment(location, `/usr/bin${delimiter}/bin`)).toEqual({
      PATH: `/r/rde-cli/bin${delimiter}/usr/bin${delimiter}/bin`,
      MB_SKILLS_DIR: "/r/rde-cli/skill-data",
      RDE_NODE: "/app",
      RDE_CLI: "/r/rde-cli/dist/cli.mjs",
    });
  });
});

describe("the mb shim", () => {
  it("runs the named CLI with the named Node as Node, passing every argument through", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rde-shim-"));
    cleanups.push(directory);
    const entry = join(directory, "cli.mjs");
    await writeFile(entry, ECHO_SCRIPT, "utf8");

    const result = await runCommand({
      command: SHIM,
      args: ["skills", "get", "core", "--json"],
      env: { RDE_NODE: process.execPath, RDE_CLI: entry },
      cwd: directory,
      timeoutMs: SHIM_TIMEOUT_MS,
      maxOutputBytes: SHIM_OUTPUT_LIMIT_BYTES,
      signal: NEVER_ABORTED,
    });

    expect(result).toEqual({
      kind: "exited",
      code: 0,
      stdout: JSON.stringify({ args: ["skills", "get", "core", "--json"], runAsNode: "1" }),
      stderr: "",
      truncated: false,
    });
  });
});
