import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { DataTestWithNowCompact } from "@metabase/client/domain/data-test";
import { parseJson } from "@metabase/client/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorCategory, cliErrorMessage } from "./cli-error";
import { type RunCliResult, cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { SEEDED } from "./seed/seeded";
import { requirementFailure, requireServer, requireServerWithout } from "./server-gate";

const Created = z.object({ id: z.number().int() });

const TRANSFORM_BODY = {
  name: "Order totals",
  source: {
    type: "query",
    query: {
      type: "native",
      database: SEEDED.warehouseDbId,
      native: { query: "SELECT id, subtotal_cents + tax_cents AS total_cents FROM orders" },
    },
  },
  target: {
    type: "table",
    database: SEEDED.warehouseDbId,
    schema: "public",
    name: "transform_test_order_totals",
  },
};

const TEST_DEFINITION = {
  name: "total adds tax",
  inputs: [
    {
      table: { schema: "public", name: "orders" },
      format: "rows",
      columns: [
        { name: "id", cast_type: "INTEGER" },
        { name: "subtotal_cents", cast_type: "BIGINT" },
        { name: "tax_cents", cast_type: "BIGINT" },
      ],
      rows: [{ id: 1, subtotal_cents: 100, tax_cents: 10 }],
    },
  ],
  expectations: [
    {
      type: "equals",
      name: "total is subtotal plus tax",
      format: "rows",
      columns: [
        { name: "id", cast_type: "INTEGER" },
        { name: "total_cents", cast_type: "BIGINT" },
      ],
      rows: [{ id: 1, total_cents: 110 }],
    },
  ],
};

const FIXED_NOW = "2026-10-13T00:00:00Z";

let bootstrap: E2EBootstrap;
const tempDirs: string[] = [];

beforeAll(async () => {
  bootstrap = await readBootstrap();
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
});

async function mb(args: string[], stdin?: string): Promise<RunCliResult> {
  const dir = await mkTempConfigHome();
  tempDirs.push(dir);
  return runCli({
    args,
    configHome: dir,
    env: { MB_URL: bootstrap.baseUrl, MB_API_KEY: bootstrap.adminApiKey },
    ...(stdin === undefined ? {} : { stdin }),
  });
}

async function createTransform(): Promise<number> {
  const created = await mb(["transform", "create", "--json"], JSON.stringify(TRANSFORM_BODY));
  expect(created.exitCode, created.stderr).toBe(0);
  return parseJson(created.stdout, Created).id;
}

const skipReason = requireServer("test › transform tests › now", ["transformTests"]);

describe.skipIf(skipReason !== null)("test e2e, transform tests, now", () => {
  it("shows a test saved without `now` as on the real clock", async () => {
    const transformId = await createTransform();
    const created = await mb(
      ["test", "create", "--id", `transform:${transformId}`, "--json"],
      JSON.stringify(TEST_DEFINITION),
    );
    expect(created.exitCode, created.stderr).toBe(0);
    const testId = parseJson(created.stdout, Created).id;

    const get = await mb(["test", "get", "--id", `transform-test:${testId}`, "--json"]);

    expect(get.exitCode, get.stderr).toBe(0);
    expect(parseJson(get.stdout, DataTestWithNowCompact)).toEqual({
      id: testId,
      name: "total adds tax",
      description: null,
      now: null,
    });
  });
});

const fixedClockSkipReason = requireServer("test › transform tests › now on a SQL transform", [
  "transformTests",
  "dataTestFixedClock",
]);

describe.skipIf(fixedClockSkipReason !== null)(
  "test e2e, transform tests, now on a SQL transform",
  () => {
    it("passes on the server's refusal of `now` on a transform written in SQL", async () => {
      const transformId = await createTransform();

      const created = await mb(
        ["test", "create", "--id", `transform:${transformId}`, "--json"],
        JSON.stringify({ ...TEST_DEFINITION, now: FIXED_NOW }),
      );

      expect(created.exitCode).toBe(1);
      expect(cliErrorMessage(created.stderr)).toContain(
        "This test cannot set `now`: its query is written in SQL, or built on a question written in SQL",
      );
    });
  },
);

const noFixedClockSkipReason =
  skipReason ??
  requireServerWithout("test › transform tests › now on a server that fixes no clock", [
    "dataTestFixedClock",
  ]);

describe.skipIf(noFixedClockSkipReason !== null)(
  "test e2e, transform tests, now on a server that fixes no clock",
  () => {
    it("refuses `now` before sending, naming the feature the server lacks", async () => {
      const transformId = await createTransform();

      const created = await mb(
        ["test", "create", "--id", `transform:${transformId}`, "--json"],
        JSON.stringify({ ...TEST_DEFINITION, now: FIXED_NOW }),
      );

      expect(created.exitCode).toBe(2);
      expect(cliErrorCategory(created.stderr)).toBe("capability");
      expect(cliErrorMessage(created.stderr)).toContain(
        requirementFailure(["dataTestFixedClock"])?.detail,
      );
    });
  },
);
