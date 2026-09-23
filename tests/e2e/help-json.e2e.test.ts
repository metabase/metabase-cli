import { afterEach, describe, expect, it } from "vitest";

import { parseJson } from "@metabase/client/json";

import main from "../../packages/cli/src/main";
import {
  buildHelpEntry,
  buildHelpIndex,
  CommandHelpEntry,
  CommandHelpIndex,
  resolveCommandPath,
} from "../../packages/cli/src/runtime/command-help";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";

describe("--help --json e2e", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function makeIsolatedConfigHome(): Promise<string> {
    const dir = await mkTempConfigHome();
    tempDirs.push(dir);
    return dir;
  }

  it("emits the full-path index of every command at the root", async () => {
    const result = await runCli({
      args: ["--help", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);

    const index = parseJson(result.stdout, CommandHelpIndex, { source: "--help --json" });
    expect(index).toEqual(await buildHelpIndex(main, []));
  });

  it("emits a group-scoped index for a command group", async () => {
    const result = await runCli({
      args: ["auth", "--help", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);

    const index = parseJson(result.stdout, CommandHelpIndex, { source: "--help --json" });
    const auth = await resolveCommandPath(main, ["auth"]);
    expect(index).toEqual(await buildHelpIndex(auth, ["auth"]));
  });

  it("reports the client methods a gated command calls and their features", async () => {
    const result = await runCli({
      args: ["save", "--help", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);

    const entry = parseJson(result.stdout, CommandHelpEntry, { source: "--help --json" });
    expect(entry.requires).toEqual({
      methods: ["gitSync.branch", "gitSync.import"],
      features: ["remoteSync"],
    });
  });

  it("reports a baseline command's methods with no features", async () => {
    const result = await runCli({
      args: ["metadata", "--help", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);

    const entry = parseJson(result.stdout, CommandHelpEntry, { source: "--help --json" });
    expect(entry.requires).toEqual({
      methods: ["database.list", "database.get", "field.values"],
      features: [],
    });
  });

  it("reports null requires for a command that never reaches a server", async () => {
    const result = await runCli({
      args: ["check", "--help", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);

    const entry = parseJson(result.stdout, CommandHelpEntry, { source: "--help --json" });
    expect(entry.requires).toBeNull();
  });

  it("emits the full entry with output schema and examples for a leaf command", async () => {
    const result = await runCli({
      args: ["metadata", "--help", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);

    const entry = parseJson(result.stdout, CommandHelpEntry, { source: "--help --json" });
    const metadata = await resolveCommandPath(main, ["metadata"]);
    expect(entry).toEqual(await buildHelpEntry(metadata, ["metadata"]));
  });
});
