import { beforeAll, describe, expect, it } from "vitest";

import { parseJson } from "@metabase/client/json";

import { TransformTagListEnvelope } from "../../packages/cli/src/commands/transform-tag/list";
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { runCli } from "./run-cli";
import { requireServer } from "./server-gate";

const BUILT_IN_TAGS = [
  { id: 1, name: "hourly", built_in_type: "hourly" },
  { id: 2, name: "daily", built_in_type: "daily" },
  { id: 3, name: "weekly", built_in_type: "weekly" },
  { id: 4, name: "monthly", built_in_type: "monthly" },
] as const;

const skipReason = requireServer("transform-tag › transform-tag e2e", ["transforms"]);

describe.skipIf(skipReason !== null)("transform-tag e2e", () => {
  let bootstrap: E2EBootstrap;

  beforeAll(async () => {
    bootstrap = await readBootstrap();
  });

  function authEnv(): Record<string, string> {
    return {
      MB_URL: bootstrap.baseUrl,
      MB_API_KEY: bootstrap.adminApiKey,
    };
  }

  it("list returns the four built-in tags on a fresh restore", async () => {
    const result = await runCli({
      args: ["transform-tag", "list", "--json"],
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const envelope = parseJson(result.stdout, TransformTagListEnvelope);
    const byId = [...envelope.data].toSorted((left, right) => left.id - right.id);
    expect(byId).toEqual([...BUILT_IN_TAGS]);
    expect({ returned: envelope.returned, total: envelope.total }).toEqual({
      returned: BUILT_IN_TAGS.length,
      total: BUILT_IN_TAGS.length,
    });
  });
});
