import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConfigError } from "../../core/errors";
import { ValidationError } from "../../core/errors";

import { parseSuite } from "./suite";

describe("parseSuite", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "mb-suite-"));
    writeFileSync(join(dir, "no_negatives.sql"), "SELECT * FROM test_output WHERE revenue < 0\n");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("parses a full suite into SubgraphRunArgs-compatible fields", async () => {
    const yaml = `
target:
  type: transform
  id: 173
sources: [172]
inputs:
  - table: 229
    file: orders.csv
expected: out.csv
ignore_columns: [snapshot_ts]
assertions:
  - name: positive_revenue
    sql: SELECT * FROM test_output WHERE revenue < 0
    severity: warn
  - name: from_file
    file: ${join(dir, "no_negatives.sql")}
`;
    const out = await parseSuite(yaml, "suite.yaml");
    expect(out.targetType).toBe("transform");
    expect(out.target).toBe(173);
    expect(out.sources).toEqual([172]);
    expect(out.inputs).toEqual([{ tableId: 229, path: "orders.csv" }]);
    expect(out.expected).toBe("out.csv");
    expect(out.ignoreColumns).toEqual(["snapshot_ts"]);
    expect(out.assertions).toEqual([
      {
        name: "positive_revenue",
        sql: "SELECT * FROM test_output WHERE revenue < 0",
        severity: "warn",
      },
      {
        name: "from_file",
        sql: "SELECT * FROM test_output WHERE revenue < 0",
        severity: "error",
      },
    ]);
  });

  it("defaults optional fields (sources, inputs, ignore_columns, assertions) to empty", async () => {
    const yaml = `
target:
  type: card
  id: 88
expected: out.csv
`;
    const out = await parseSuite(yaml, "suite.yaml");
    expect(out.targetType).toBe("card");
    expect(out.target).toBe(88);
    expect(out.sources).toEqual([]);
    expect(out.inputs).toEqual([]);
    expect(out.ignoreColumns).toEqual([]);
    expect(out.assertions).toEqual([]);
    expect(out.expected).toBe("out.csv");
  });

  it("leaves expected undefined when absent", async () => {
    const yaml = `
target:
  type: transform
  id: 1
assertions:
  - name: a
    sql: SELECT 1
`;
    const out = await parseSuite(yaml, "suite.yaml");
    expect(out.expected).toBeUndefined();
  });

  it("rejects an assertion with neither sql nor file", async () => {
    const yaml = `
target:
  type: transform
  id: 1
assertions:
  - name: bad
`;
    await expect(parseSuite(yaml, "suite.yaml")).rejects.toThrow(ConfigError);
  });

  it("rejects an assertion with both sql and file", async () => {
    const yaml = `
target:
  type: transform
  id: 1
assertions:
  - name: bad
    sql: SELECT 1
    file: x.sql
`;
    await expect(parseSuite(yaml, "suite.yaml")).rejects.toThrow(ConfigError);
  });

  it("surfaces a schema ValidationError for a malformed target", async () => {
    const yaml = `target: "nope"`;
    await expect(parseSuite(yaml, "suite.yaml")).rejects.toThrow(ValidationError);
  });
});
