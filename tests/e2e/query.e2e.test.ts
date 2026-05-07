import { afterEach, describe, expect, it } from "vitest";

import {
  getQuerySchemaBundle,
  QuerySchemaBundle,
  ValidationOutcome,
} from "../../src/core/schema/validate";
import { parseJson } from "../../src/runtime/json";

import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";

const VALID_EXTERNAL = {
  "lib/type": "mbql/query",
  database: "My DB",
  stages: [
    {
      "lib/type": "mbql.stage/mbql",
      "source-table": ["My DB", null, "orders"],
    },
  ],
};

const VALID_INTERNAL = {
  "lib/type": "mbql/query",
  database: 1,
  stages: [
    {
      "lib/type": "mbql.stage/mbql",
      "source-table": 7,
    },
  ],
};

const EMPTY_STAGES_QUERY = {
  "lib/type": "mbql/query",
  database: 1,
  stages: [],
};

describe("query e2e", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function makeIsolatedConfigHome(): Promise<string> {
    const dir = await mkTempConfigHome();
    tempDirs.push(dir);
    return dir;
  }

  it("--print-schema (default) emits the internal-mode bundle with all 4 common defs", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["query", "--print-schema"],
      configHome,
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, QuerySchemaBundle)).toEqual(getQuerySchemaBundle("internal"));
  });

  it("--print-schema --external emits the external-mode bundle", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["query", "--print-schema", "--external"],
      configHome,
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, QuerySchemaBundle)).toEqual(getQuerySchemaBundle("external"));
  });

  it("--dry-run (default = internal) with a valid numeric-IDs body returns ok and exits 0", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["query", "--dry-run"],
      stdin: JSON.stringify(VALID_INTERNAL),
      configHome,
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, ValidationOutcome)).toEqual({ ok: true, errors: [] });
  });

  it("--external --dry-run with a valid string-FK body returns ok and exits 0", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["query", "--external", "--dry-run"],
      stdin: JSON.stringify(VALID_EXTERNAL),
      configHome,
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, ValidationOutcome)).toEqual({ ok: true, errors: [] });
  });

  it("--dry-run (default = internal) rejects external-shaped IDs (string database, FK-tuple source-table)", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["query", "--dry-run"],
      stdin: JSON.stringify(VALID_EXTERNAL),
      configHome,
    });

    expect(result.exitCode).toBe(2);
    expect(parseJson(result.stdout, ValidationOutcome)).toEqual({
      ok: false,
      errors: [
        { path: "/database", message: "must be integer" },
        { path: "/stages/0/source-table", message: "must be integer" },
        { path: "/stages/0", message: 'must match "then" schema' },
      ],
    });
    expect(result.stderr).toContain("validation failed: 3 error(s)");
  });

  it("--external --dry-run rejects internal-shaped IDs (integer database, integer source-table)", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["query", "--external", "--dry-run"],
      stdin: JSON.stringify(VALID_INTERNAL),
      configHome,
    });

    expect(result.exitCode).toBe(2);
    expect(parseJson(result.stdout, ValidationOutcome)).toEqual({
      ok: false,
      errors: [
        { path: "/database", message: "must be string" },
        { path: "/stages/0/source-table", message: "must be array" },
        { path: "/stages/0", message: 'must match "then" schema' },
      ],
    });
    expect(result.stderr).toContain("validation failed: 3 error(s)");
  });

  it("--dry-run with an empty stages array reports the structural error and exits 2", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["query", "--dry-run"],
      stdin: JSON.stringify(EMPTY_STAGES_QUERY),
      configHome,
    });

    expect(result.exitCode).toBe(2);
    expect(parseJson(result.stdout, ValidationOutcome)).toEqual({
      ok: false,
      errors: [{ path: "/stages", message: "must NOT have fewer than 1 items" }],
    });
    expect(result.stderr).toContain("validation failed: 1 error(s)");
  });

  it("run (no --dry-run) with an invalid body refuses to send and points at --dry-run", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["query"],
      stdin: JSON.stringify(EMPTY_STAGES_QUERY),
      configHome,
    });

    expect(result.exitCode).toBe(2);
    expect(parseJson(result.stdout, ValidationOutcome)).toEqual({
      ok: false,
      errors: [{ path: "/stages", message: "must NOT have fewer than 1 items" }],
    });
    expect(result.stderr).toContain(
      "validation failed: 1 error(s) — pass --dry-run to validate without sending",
    );
  });

  it("--dry-run with malformed JSON exits 2 with a ConfigError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["query", "--dry-run"],
      stdin: "not json",
      configHome,
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("request body: invalid JSON:");
    expect(result.stdout).toBe("");
  });
});
