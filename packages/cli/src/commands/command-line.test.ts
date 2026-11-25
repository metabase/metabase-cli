import { defineCommand } from "citty";
import { describe, expect, it } from "vitest";

import { ConfigError, errorMessage } from "@metabase/client/errors";

import { assertCommandLine } from "./command-line";
import { profileFlag } from "./flags";
import { defineCommandGroup } from "./group";
import { defineMetabaseCommand } from "./runtime";

const get = defineMetabaseCommand({
  meta: { name: "get" },
  requires: null,
  args: {
    ...profileFlag,
    verbose: { type: "boolean" },
    id: { type: "positional", required: true },
  },
  run() {
    throw new Error("a checked command must not run");
  },
});

const root = defineCommand({
  meta: { name: "mb" },
  subCommands: {
    thing: defineCommandGroup({
      name: "thing",
      description: "Manage things",
      subCommands: { get: () => Promise.resolve(get) },
    }),
  },
});

describe("assertCommandLine", () => {
  it.each([
    [["thing", "get", "1", "--verbose"]],
    [["--profile", "staging", "thing", "get", "1"]],
    [["thing", "get", "-5"]],
    [["thing", "get", "--help"]],
    [["thing", "--help", "--json"]],
    [["--version"]],
  ])("takes a command line the CLI takes, and runs nothing: %j", async (argv) => {
    await expect(assertCommandLine(root, argv)).resolves.toBeUndefined();
  });

  it.each([
    [["thang", "get", "1"], "unknown command: thang"],
    [["thing", "gte", "1"], "unknown command: gte"],
    [["thing", "get", "1", "--loud"], "unknown flag: --loud"],
    [["thing", "get", "--loud", "--help"], "unknown flag: --loud"],
    [["thing", "get"], "missing argument: <id> (this command takes <id>)"],
    [
      ["thing", "get", "1", "2"],
      'unexpected argument: "2" (this command takes <id>; quote an argument that contains spaces)',
    ],
    [["thing", "--verbose"], "--verbose follows a command group; name one of the group's commands"],
  ])("refuses a command line the CLI refuses: %j", async (argv, message) => {
    const error = await assertCommandLine(root, argv).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConfigError);
    expect(errorMessage(error)).toBe(message);
  });
});
