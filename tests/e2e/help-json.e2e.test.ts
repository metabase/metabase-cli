import { describe, expect, it } from "vitest";

import { parseJson } from "@metabase/client/json";

import main from "../../packages/cli/src/main";
import {
  buildHelpEntry,
  buildHelpIndex,
  CommandHelpEntry,
  CommandHelpIndex,
  resolveCommandPath,
} from "../../packages/cli/src/runtime/command-help";
import { runCli } from "./run-cli";

describe("--help --json e2e", () => {
  it("emits the full-path index of every command at the root", async () => {
    const result = await runCli({
      args: ["--help", "--json"],
    });

    expect(result.exitCode, result.stderr).toBe(0);

    const index = parseJson(result.stdout, CommandHelpIndex, { source: "--help --json" });
    expect(index).toEqual(await buildHelpIndex(main, []));
  });

  it("emits a group-scoped index for a command group", async () => {
    const result = await runCli({
      args: ["card", "--help", "--json"],
    });

    expect(result.exitCode, result.stderr).toBe(0);

    const index = parseJson(result.stdout, CommandHelpIndex, { source: "--help --json" });
    const card = await resolveCommandPath(main, ["card"]);
    expect(index).toEqual(await buildHelpIndex(card, ["card"]));
  });

  it("reports every client method a gated command calls and the features they need once", async () => {
    const result = await runCli({
      args: ["library", "publish", "--help", "--json"],
    });

    expect(result.exitCode, result.stderr).toBe(0);

    const entry = parseJson(result.stdout, CommandHelpEntry, { source: "--help --json" });
    expect(entry.requires).toEqual({
      methods: ["library.ensureDataCollectionId", "library.publishTables", "gitSync.remoteUrl"],
      features: ["library"],
    });
  });

  it("reports the premium feature behind a token-gated command", async () => {
    const result = await runCli({
      args: ["library", "get", "--help", "--json"],
    });

    expect(result.exitCode, result.stderr).toBe(0);

    const entry = parseJson(result.stdout, CommandHelpEntry, { source: "--help --json" });
    expect(entry.requires).toEqual({ methods: ["library.get"], features: ["library"] });
  });

  it("reports a baseline command's methods with no features", async () => {
    const result = await runCli({
      args: ["card", "list", "--help", "--json"],
    });

    expect(result.exitCode, result.stderr).toBe(0);

    const entry = parseJson(result.stdout, CommandHelpEntry, { source: "--help --json" });
    expect(entry.requires).toEqual({ methods: ["card.list"], features: [] });
  });

  it("reports null requires for a command that never reaches a server", async () => {
    const result = await runCli({
      args: ["uuid", "--help", "--json"],
    });

    expect(result.exitCode, result.stderr).toBe(0);

    const entry = parseJson(result.stdout, CommandHelpEntry, { source: "--help --json" });
    expect(entry.requires).toBeNull();
  });

  it("emits the full entry with output schema and examples for a leaf command", async () => {
    const result = await runCli({
      args: ["card", "query", "--help", "--json"],
    });

    expect(result.exitCode, result.stderr).toBe(0);

    const entry = parseJson(result.stdout, CommandHelpEntry, { source: "--help --json" });
    const cardQuery = await resolveCommandPath(main, ["card", "query"]);
    expect(entry).toEqual(await buildHelpEntry(cardQuery, ["card", "query"]));
  });
});
