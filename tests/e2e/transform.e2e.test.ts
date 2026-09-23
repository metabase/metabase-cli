import { assert, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  type TransformRun,
  TransformRunCompact,
  TransformRunResult,
} from "@metabase/client/domain/transform";
import { parseJson } from "@metabase/client/json";

import { TransformDependenciesEnvelope } from "../../packages/cli/src/commands/transform/dependencies";
import { TransformListEnvelope } from "../../packages/cli/src/commands/transform/list";
import { TransformRunListEnvelope } from "../../packages/cli/src/commands/transform/runs";
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorMessage } from "./cli-error";
import { runCli } from "./run-cli";
import { SEEDED } from "./seed/seeded";
import { bootstrapServerInfo, clearCachedProbes, seedCachedProbeAt } from "./seed-probe";
import { requireSeededTransform, requireServer, serverHas } from "./server-gate";

const SEED_TRANSFORM_NAME = "e2e_orders_by_status";

const skipReason = requireServer("transform › transform e2e", ["transforms"]);
const seededTransformId =
  skipReason === null ? requireSeededTransform("transform › over the seeded transform") : null;

function runIdOf(result: TransformRunResult): number {
  if (result.run_id === null) {
    throw new Error(`no run started: ${result.message}`);
  }
  return result.run_id;
}

function finalRunOf(result: TransformRunResult): TransformRun {
  if (result.final === null) {
    throw new Error("expected the final run to be reported after waiting");
  }
  return result.final;
}

describe.skipIf(seededTransformId === null)("transform e2e over the seeded transform", () => {
  let bootstrap: E2EBootstrap;
  let transformId: number;

  beforeAll(async () => {
    bootstrap = await readBootstrap();
    if (seededTransformId === null) {
      throw new Error("the seeded transform gate let the suite run without a transform");
    }
    transformId = seededTransformId;
  });

  function authEnv(): Record<string, string> {
    return {
      MB_URL: bootstrap.baseUrl,
      MB_API_KEY: bootstrap.adminApiKey,
    };
  }

  function seedTransformCompact() {
    return {
      id: transformId,
      name: SEED_TRANSFORM_NAME,
      description: null,
      source_type: "native",
      target: {
        type: "table",
        database: SEEDED.warehouseDbId,
        schema: "public",
        name: SEED_TRANSFORM_NAME,
      },
      target_db_id: SEEDED.warehouseDbId,
      target_table_id: serverHas("transformTargetTableLinkedOnCreate") ? expect.any(Number) : null,
    };
  }

  it("list returns the seeded transform as the only entry", async () => {
    const result = await runCli({ args: ["transform", "list", "--json"], env: authEnv() });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TransformListEnvelope)).toEqual({
      data: [seedTransformCompact()],
      returned: 1,
      offset: 0,
      total: 1,
      has_more: false,
      next_offset: null,
    });
  });

  it("run --wait polls until the run reaches a terminal status and get-run reads it back", async () => {
    const result = await runCli({
      args: ["transform", "run", String(transformId), "--wait", "--json"],
      env: authEnv(),
      timeoutMs: 120_000,
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const parsed = parseJson(result.stdout, TransformRunResult);
    const runId = runIdOf(parsed);
    const finalRun = finalRunOf(parsed);
    expect(parsed.message).toBe("Transform run started");
    expect({
      id: finalRun.id,
      transform_id: finalRun.transform_id,
      status: finalRun.status,
    }).toEqual({ id: runId, transform_id: transformId, status: "succeeded" });

    const fetched = await runCli({
      args: ["transform", "get-run", String(runId), "--json"],
      env: authEnv(),
    });
    expect(fetched.exitCode, fetched.stderr).toBe(0);
    expect(parseJson(fetched.stdout, TransformRunCompact)).toEqual({
      id: runId,
      transform_id: transformId,
      status: "succeeded",
      run_method: "manual",
      start_time: expect.any(String),
      end_time: expect.any(String),
      message: null,
    });
  });

  it("runs lists the completed run of the seeded transform", async () => {
    const kickoff = await runCli({
      args: ["transform", "run", String(transformId), "--wait", "--json"],
      env: authEnv(),
      timeoutMs: 120_000,
    });
    expect(kickoff.exitCode, kickoff.stderr).toBe(0);
    const runId = runIdOf(parseJson(kickoff.stdout, TransformRunResult));

    const result = await runCli({
      args: ["transform", "runs", "--transform-id", String(transformId), "--json"],
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TransformRunListEnvelope)).toEqual({
      data: [
        {
          id: runId,
          transform_id: transformId,
          status: "succeeded",
          run_method: "manual",
          start_time: expect.any(String),
          end_time: expect.any(String),
          message: null,
        },
      ],
      returned: 1,
      offset: 0,
      total: 1,
      has_more: false,
      next_offset: null,
    });
  });

  it("dependencies returns an empty envelope for the standalone seeded transform", async () => {
    const result = await runCli({
      args: ["transform", "dependencies", String(transformId), "--json"],
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TransformDependenciesEnvelope)).toEqual({
      data: [],
      returned: 0,
      offset: 0,
      total: 0,
      has_more: false,
      next_offset: null,
    });
  });
});

describe.skipIf(skipReason !== null)("transform e2e", () => {
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

  it("get with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["transform", "get", "abc", "--json"],
      env: authEnv(),
    });
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("get against a missing id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["transform", "get", "9999999", "--json"],
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(cliErrorMessage(result.stderr)).toBe("Not found: GET /api/transform/9999999.");
  });

  it("get-run with non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["transform", "get-run", "abc", "--json"],
      env: authEnv(),
    });
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe('invalid run id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("get-run against a missing run id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["transform", "get-run", "9999999", "--json"],
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(cliErrorMessage(result.stderr)).toBe("Not found: GET /api/transform/run/9999999.");
  });

  it("runs with non-integer --transform-id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["transform", "runs", "--transform-id", "abc", "--json"],
      env: authEnv(),
    });
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe('invalid --transform-id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("cancel with non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["transform", "cancel", "abc", "--json"],
      env: authEnv(),
    });
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("dependencies with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["transform", "dependencies", "abc", "--json"],
      env: authEnv(),
    });
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("dependencies against a missing id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["transform", "dependencies", "9999999", "--json"],
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(cliErrorMessage(result.stderr)).toBe(
      "Not found: GET /api/transform/9999999/dependencies.",
    );
  });
});

describe.skipIf(serverHas("transforms"))(
  "transform capability gate against a server without transforms",
  () => {
    let bootstrap: E2EBootstrap;

    beforeAll(async () => {
      bootstrap = await readBootstrap();
    });

    beforeEach(clearCachedProbes);

    function authEnv(): Record<string, string> {
      return {
        MB_URL: bootstrap.baseUrl,
        MB_API_KEY: bootstrap.adminApiKey,
      };
    }

    async function seedLiveServerProbe(): Promise<void> {
      await seedCachedProbeAt(bootstrap.baseUrl, bootstrapServerInfo(bootstrap.server));
    }

    it("transform list refuses with CapabilityError (exit 2) naming the v59 requirement", async () => {
      const serverTag = bootstrap.server.version?.tag;
      assert(serverTag !== undefined, "gate block requires a known cached server version");
      await seedLiveServerProbe();

      const result = await runCli({ args: ["transform", "list", "--json"], env: authEnv() });

      expect(result.exitCode).toBe(2);
      expect(cliErrorMessage(result.stderr)).toBe(
        `This operation requires Metabase v59+ (this server is ${serverTag}). Upgrade Metabase to use it.`,
      );
      expect(result.stdout).toBe("");
    });

    it("transform list without a cached probe asks the server once and refuses the same way", async () => {
      const serverTag = bootstrap.server.version?.tag;
      assert(serverTag !== undefined, "gate block requires a known cached server version");

      const result = await runCli({ args: ["transform", "list", "--json"], env: authEnv() });

      expect(result.exitCode).toBe(2);
      expect(cliErrorMessage(result.stderr)).toBe(
        `This operation requires Metabase v59+ (this server is ${serverTag}). Upgrade Metabase to use it.`,
      );
      expect(result.stdout).toBe("");
    });

    it("--skip-preflight bypasses the gate and surfaces the raw server 404 the gate prevents (exit 1)", async () => {
      const serverTag = bootstrap.server.version?.tag;
      assert(serverTag !== undefined, "gate block requires a known cached server version");
      await seedLiveServerProbe();

      const result = await runCli({
        args: ["transform", "list", "--skip-preflight", "--json"],
        env: authEnv(),
      });

      expect(result.exitCode).toBe(1);
      expect(cliErrorMessage(result.stderr)).toBe(
        `This endpoint is not available on Metabase ${serverTag}: GET /api/transform. ` +
          "It may require a newer Metabase major version.",
      );
      expect(result.stdout).toBe("");
    });
  },
);
