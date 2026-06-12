import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { MeasureListEnvelope } from "../../src/commands/measure/list";
import { ValidationOutcome } from "../../src/core/schema/validate";
import { MeasureCompact, type MeasureCreateInput } from "../../src/domain/measure";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { cliErrorMessage } from "./cli-error";
import { SEEDED } from "./seed/seeded";
import { requireServer } from "./server-gate";
const FIRST_NEW_MEASURE_ID = 1;
const MEASURE_NAME = "OrderCount";
const MEASURE_DESCRIPTION = "Count of orders rows.";

const NEW_MEASURE_COMPACT = {
  id: FIRST_NEW_MEASURE_ID,
  name: MEASURE_NAME,
  description: MEASURE_DESCRIPTION,
  archived: false,
  table_id: SEEDED.tables.orders,
} as const;

const NEW_MEASURE_BODY: MeasureCreateInput = {
  name: MEASURE_NAME,
  table_id: SEEDED.tables.orders,
  description: MEASURE_DESCRIPTION,
  definition: {
    "source-table": SEEDED.tables.orders,
    aggregation: [["count"]],
  },
};

const skipReason = requireServer({ minVersion: 59 });

describe.skipIf(skipReason !== null)("measure e2e", () => {
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

  async function createMeasure(): Promise<void> {
    const result = await runCli({
      args: ["measure", "create", "--json"],
      stdin: JSON.stringify(NEW_MEASURE_BODY),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
  }

  it("list returns an empty envelope on a fresh restore", async () => {
    const result = await runCli({
      args: ["measure", "list", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, MeasureListEnvelope)).toEqual({
      data: [],
      returned: 0,
      total: 0,
    });
  });

  it("create returns the hydrated measure in compact form by default", async () => {
    const result = await runCli({
      args: ["measure", "create", "--json"],
      stdin: JSON.stringify(NEW_MEASURE_BODY),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, MeasureCompact)).toEqual(NEW_MEASURE_COMPACT);
  });

  it("create + list shows the new measure via the compact projection", async () => {
    await createMeasure();

    const listResult = await runCli({
      args: ["measure", "list", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(listResult.exitCode, listResult.stderr).toBe(0);
    expect(parseJson(listResult.stdout, MeasureListEnvelope)).toEqual({
      data: [NEW_MEASURE_COMPACT],
      returned: 1,
      total: 1,
    });
  });

  it("create with invalid MBQL 5 definition fails pre-flight before sending", async () => {
    const result = await runCli({
      args: ["measure", "create", "--json"],
      stdin: JSON.stringify({
        name: "preflight-fail",
        table_id: SEEDED.tables.orders,
        definition: {
          "lib/type": "mbql/query",
          database: SEEDED.warehouseDbId,
          stages: [],
        },
      }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(parseJson(result.stdout, ValidationOutcome)).toEqual({
      ok: false,
      errors: [{ path: "/stages", message: "must NOT have fewer than 1 items" }],
    });
    expect(result.stderr).toContain(
      "measure.definition validation failed: 1 error(s) — pass valid MBQL 5 or use the legacy format",
    );
  });

  it("create --skip-validate bypasses the MBQL 5 pre-flight (server is the authority)", async () => {
    const result = await runCli({
      args: ["measure", "create", "--skip-validate", "--json"],
      stdin: JSON.stringify({
        name: "skip-validate-bypass",
        table_id: SEEDED.tables.orders,
        definition: {
          "lib/type": "mbql/query",
          database: SEEDED.warehouseDbId,
          stages: [],
        },
      }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Metabase returned 500");
    expect(result.stdout).toBe("");
  });

  it("create with a body missing required fields fails on Zod validation", async () => {
    const result = await runCli({
      args: ["measure", "create", "--json"],
      stdin: JSON.stringify({ name: "missing-table-and-definition" }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("request body: value did not match expected schema");
    expect(result.stdout).toBe("");
  });

  it("get returns the measure by id in compact form", async () => {
    await createMeasure();

    const result = await runCli({
      args: ["measure", "get", String(FIRST_NEW_MEASURE_ID), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, MeasureCompact)).toEqual(NEW_MEASURE_COMPACT);
  });

  it("get with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["measure", "get", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("get against a missing measure id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["measure", "get", "9999999", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Not found: GET /api/measure/9999999.");
  });

  it("update renames the measure and the compact view reflects the new name", async () => {
    await createMeasure();

    const result = await runCli({
      args: ["measure", "update", String(FIRST_NEW_MEASURE_ID), "--json"],
      stdin: JSON.stringify({ name: "OrderCountRenamed", revision_message: "rename" }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, MeasureCompact)).toEqual({
      ...NEW_MEASURE_COMPACT,
      name: "OrderCountRenamed",
    });
  });

  it("update with invalid MBQL 5 definition fails pre-flight before sending", async () => {
    await createMeasure();

    const result = await runCli({
      args: ["measure", "update", String(FIRST_NEW_MEASURE_ID), "--json"],
      stdin: JSON.stringify({
        revision_message: "bad definition",
        definition: {
          "lib/type": "mbql/query",
          database: SEEDED.warehouseDbId,
          stages: [],
        },
      }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(parseJson(result.stdout, ValidationOutcome)).toEqual({
      ok: false,
      errors: [{ path: "/stages", message: "must NOT have fewer than 1 items" }],
    });
    expect(result.stderr).toContain(
      "measure.definition validation failed: 1 error(s) — pass valid MBQL 5 or use the legacy format",
    );
  });

  it("update without the required revision_message fails on Zod validation", async () => {
    await createMeasure();

    const result = await runCli({
      args: ["measure", "update", String(FIRST_NEW_MEASURE_ID), "--json"],
      stdin: JSON.stringify({ name: "no-revision" }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("request body: value did not match expected schema");
    expect(result.stdout).toBe("");
  });

  it("update with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["measure", "update", "abc", "--json"],
      stdin: JSON.stringify({ revision_message: "x" }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("archive flips archived from false to true and list excludes it", async () => {
    await createMeasure();

    const archiveResult = await runCli({
      args: ["measure", "archive", String(FIRST_NEW_MEASURE_ID), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(archiveResult.exitCode, archiveResult.stderr).toBe(0);
    expect(parseJson(archiveResult.stdout, MeasureCompact)).toEqual({
      ...NEW_MEASURE_COMPACT,
      archived: true,
    });

    const listResult = await runCli({
      args: ["measure", "list", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(listResult.exitCode, listResult.stderr).toBe(0);
    expect(parseJson(listResult.stdout, MeasureListEnvelope)).toEqual({
      data: [],
      returned: 0,
      total: 0,
    });
  });

  it("archive with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["measure", "archive", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });
});
