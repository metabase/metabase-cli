import { afterEach, assert, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  Field,
  FieldCompact,
  FieldDataSensitivity,
  FieldSummary,
  FieldValues,
  FieldWithDataSensitivityCompact,
} from "@metabase/client/domain/field";
import { parseJson } from "@metabase/client/json";

import { FieldSearchListEnvelope } from "../../packages/cli/src/commands/field/search";
import { FieldListEnvelope } from "../../packages/cli/src/commands/table/fields";
import { PREFLIGHT_SKIP_REMEDY } from "../../packages/cli/src/output/notice";
import { FieldRemappingResult } from "../../packages/cli/src/output/views/field";
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorCategory, cliErrorMessage } from "./cli-error";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { seedProbedProfile, UNREACHABLE_SEED_MESSAGE } from "./seed-profile";
import { SEEDED } from "./seed/seeded";
import { requireServer, serverHas } from "./server-gate";

const DOWNGRADE_REMEDY = "Or install an `@metabase/cli` release that targets this server.";

function sensitivityRefusal(serverTag: string): string {
  return `This operation requires Metabase v64+ (this server is ${serverTag}). Upgrade Metabase to use it.\n${DOWNGRADE_REMEDY}\n${PREFLIGHT_SKIP_REMEDY}`;
}

describe("field e2e", () => {
  let bootstrap: E2EBootstrap;
  let customersEmailFieldId: number;
  let customersIdFieldId: number;
  let customersNameFieldId: number;
  let ordersCustomerIdFieldId: number;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    bootstrap = await readBootstrap();
    customersEmailFieldId = await fieldNamed(SEEDED.tables.customers, "email");
    customersIdFieldId = await fieldNamed(SEEDED.tables.customers, "id");
    customersNameFieldId = await fieldNamed(SEEDED.tables.customers, "full_name");
    ordersCustomerIdFieldId = await fieldNamed(SEEDED.tables.orders, "customer_id");
  });

  async function fieldNamed(tableId: number, name: string): Promise<number> {
    const result = await runCli({
      args: ["table", "fields", String(tableId), "--json", "--max-bytes", "0"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const field = parseJson(result.stdout, FieldListEnvelope).data.find((row) => row.name === name);
    assert(field !== undefined, `no field ${name} on table ${tableId}`);
    return field.id;
  }

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
      MB_URL: bootstrap.baseUrl,
      MB_API_KEY: bootstrap.adminApiKey,
    };
  }

  function emailFieldCompact(): FieldCompact {
    return {
      id: customersEmailFieldId,
      name: "email",
      display_name: "Email",
      description: null,
      table_id: SEEDED.tables.customers,
      base_type: "type/Text",
      semantic_type: "type/Email",
      fk_target_field_id: null,
    };
  }

  it("get returns the customers.email field with the expected compact projection", async () => {
    const result = await runCli({
      args: ["field", "get", String(customersEmailFieldId), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const expected = serverHas("fieldDataSensitivity")
      ? { ...emailFieldCompact(), data_sensitivity: null }
      : emailFieldCompact();
    const printed = z.union([FieldWithDataSensitivityCompact, FieldCompact]);
    expect(parseJson(result.stdout, printed)).toEqual(expected);
  });

  it("get with a non-integer id fails fast with ConfigError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["field", "get", "x", "--json"],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "x" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("get against a missing field id surfaces a 404 HttpError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["field", "get", "9999999", "--json"],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Not found: GET /api/field/9999999.");
  });

  it("values returns the FieldValues envelope for the email field", async () => {
    const result = await runCli({
      args: ["field", "values", String(customersEmailFieldId), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const parsed = parseJson(result.stdout, FieldValues);
    expect(parsed.field_id).toBe(customersEmailFieldId);
  });

  it("values with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["field", "values", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
  });

  it("summary returns the count and distinct count for the email field", async () => {
    const result = await runCli({
      args: ["field", "summary", String(customersEmailFieldId), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const parsed = parseJson(result.stdout, FieldSummary);
    expect(parsed.field_id).toBe(customersEmailFieldId);
  });

  it("summary against a missing field id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["field", "summary", "9999999", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Not found: GET /api/field/9999999/summary.");
  });

  it("update edits the email field description and restores it", async () => {
    const newDescription = `e2e field update marker ${Date.now()}`;
    const update = await runCli({
      args: [
        "field",
        "update",
        String(customersEmailFieldId),
        "--body",
        JSON.stringify({ description: newDescription }),
        "--json",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(update.exitCode, update.stderr).toBe(0);
    expect(parseJson(update.stdout, Field).description).toBe(newDescription);

    const restore = await runCli({
      args: [
        "field",
        "update",
        String(customersEmailFieldId),
        "--body",
        JSON.stringify({ description: null }),
        "--json",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(restore.exitCode, restore.stderr).toBe(0);
    expect(parseJson(restore.stdout, Field).description).toBeNull();
  });

  it("update rejects multiple body sources", async () => {
    const result = await runCli({
      args: [
        "field",
        "update",
        String(customersEmailFieldId),
        "--body",
        '{"description":"x"}',
        "--file",
        "patch.json",
        "--json",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("multiple body sources given");
  });

  it("update with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["field", "update", "abc", "--body", '{"description":"x"}', "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
  });

  it("update enforces the input schema for an unknown enum value", async () => {
    const result = await runCli({
      args: [
        "field",
        "update",
        String(customersEmailFieldId),
        "--body",
        JSON.stringify({ visibility_type: "not-a-real-value" }),
        "--json",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("value did not match expected schema");
  });

  it("search answers the id/name pairs whose name contains the value", async () => {
    const result = await runCli({
      args: [
        "field",
        "search",
        String(customersIdFieldId),
        String(customersNameFieldId),
        "--value",
        "an",
        "--json",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, FieldSearchListEnvelope)).toEqual({
      data: [{ value: 3, label: "Alan Turing" }],
      returned: 1,
      offset: 0,
      total: null,
      has_more: false,
      next_offset: null,
    });
  });

  it("search follows a FK to the key it points at", async () => {
    const result = await runCli({
      args: [
        "field",
        "search",
        String(ordersCustomerIdFieldId),
        String(customersNameFieldId),
        "--value",
        "an",
        "--json",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, FieldSearchListEnvelope).data).toEqual([
      { value: 3, label: "Alan Turing" },
    ]);
  });

  it("search proves has_more with a row past the window and resumes at next_offset", async () => {
    const firstWindow = await runCli({
      args: [
        "field",
        "search",
        String(customersIdFieldId),
        String(customersNameFieldId),
        "--value",
        "a",
        "--limit",
        "2",
        "--json",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(firstWindow.exitCode, firstWindow.stderr).toBe(0);
    expect(parseJson(firstWindow.stdout, FieldSearchListEnvelope)).toEqual({
      data: [
        { value: 1, label: "Ada Lovelace" },
        { value: 2, label: "Grace Hopper" },
      ],
      returned: 2,
      offset: 0,
      limit: 2,
      total: null,
      has_more: true,
      next_offset: 2,
    });

    const lastWindow = await runCli({
      args: [
        "field",
        "search",
        String(customersIdFieldId),
        String(customersNameFieldId),
        "--value",
        "a",
        "--limit",
        "2",
        "--offset",
        "4",
        "--json",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(lastWindow.exitCode, lastWindow.stderr).toBe(0);
    expect(parseJson(lastWindow.stdout, FieldSearchListEnvelope)).toEqual({
      data: [
        { value: 5, label: "Edsger Dijkstra" },
        { value: 6, label: "Margaret Hamilton" },
      ],
      returned: 2,
      offset: 4,
      limit: 2,
      total: null,
      has_more: false,
      next_offset: null,
    });
  });

  it("search without a value lists the first --limit rows", async () => {
    const result = await runCli({
      args: [
        "field",
        "search",
        String(customersIdFieldId),
        String(customersNameFieldId),
        "--limit",
        "2",
        "--json",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, FieldSearchListEnvelope)).toEqual({
      data: [
        { value: 1, label: "Ada Lovelace" },
        { value: 2, label: "Grace Hopper" },
      ],
      returned: 2,
      offset: 0,
      limit: 2,
      total: null,
      has_more: true,
      next_offset: 2,
    });
  });

  it("search of a field by itself answers the value once, with a null label", async () => {
    const result = await runCli({
      args: [
        "field",
        "search",
        String(customersNameFieldId),
        String(customersNameFieldId),
        "--value",
        "an",
        "--json",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, FieldSearchListEnvelope).data).toEqual([
      { value: "Alan Turing", label: null },
    ]);
  });

  it("search with no match answers an empty window", async () => {
    const result = await runCli({
      args: [
        "field",
        "search",
        String(customersIdFieldId),
        String(customersNameFieldId),
        "--value",
        "zzz",
        "--json",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, FieldSearchListEnvelope)).toEqual({
      data: [],
      returned: 0,
      offset: 0,
      total: null,
      has_more: false,
      next_offset: null,
    });
  });

  it("search with neither value nor limit refuses before any request", async () => {
    const result = await runCli({
      args: ["field", "search", String(customersIdFieldId), String(customersNameFieldId), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe("--limit is required when --value is absent");
    expect(result.stdout).toBe("");
  });

  it("search with a blank value fails fast with ConfigError", async () => {
    const result = await runCli({
      args: [
        "field",
        "search",
        String(customersIdFieldId),
        String(customersNameFieldId),
        "--value",
        "",
        "--json",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe("invalid --value: must not be blank");
  });

  it("search with a non-integer search-id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["field", "search", String(customersIdFieldId), "abc", "--value", "an", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid search-id: "abc" (expected integer)');
  });

  it("search against a missing field id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["field", "search", "9999999", String(customersNameFieldId), "--value", "an", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      `Not found: GET /api/field/9999999/search/${customersNameFieldId}?value=an&limit=1000.`,
    );
  });

  it("remapping answers the remapped field's value on the matching row", async () => {
    const result = await runCli({
      args: [
        "field",
        "remapping",
        String(customersIdFieldId),
        String(customersNameFieldId),
        "1",
        "--json",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, FieldRemappingResult)).toEqual({
      found: true,
      value: 1,
      label: "Ada Lovelace",
    });
  });

  it("remapping prints the bare label in text mode", async () => {
    const result = await runCli({
      args: [
        "field",
        "remapping",
        String(customersIdFieldId),
        String(customersNameFieldId),
        "1",
        "--format",
        "text",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toBe("Ada Lovelace");
  });

  it("remapping with no matching row answers found: false, and an empty line in text mode", async () => {
    const json = await runCli({
      args: [
        "field",
        "remapping",
        String(customersIdFieldId),
        String(customersNameFieldId),
        "999",
        "--json",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(json.exitCode, json.stderr).toBe(0);
    expect(parseJson(json.stdout, FieldRemappingResult)).toEqual({ found: false });

    const text = await runCli({
      args: [
        "field",
        "remapping",
        String(customersIdFieldId),
        String(customersNameFieldId),
        "999",
        "--format",
        "text",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(text.exitCode, text.stderr).toBe(0);
    expect(text.stdout).toBe("");
  });

  it("remapping with a blank value fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["field", "remapping", String(customersIdFieldId), String(customersNameFieldId), " "],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe("invalid value: must not be blank");
  });

  it("remapping with a non-integer remapped-id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["field", "remapping", String(customersIdFieldId), "abc", "1", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain(
      'invalid remapped-id: "abc" (expected integer)',
    );
  });

  it("remapping against a missing field id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["field", "remapping", "9999999", String(customersNameFieldId), "1", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      `Not found: GET /api/field/9999999/remapping/${customersNameFieldId}?value=1.`,
    );
  });

  it("set-sensitivity refuses an unknown label before any request", async () => {
    const result = await runCli({
      args: ["field", "set-sensitivity", String(customersEmailFieldId), "secret", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(
      `invalid label: "secret" (expected one of: ${[...FieldDataSensitivity.options, "none"].join(", ")})`,
    );
    expect(result.stdout).toBe("");
  });

  it("set-sensitivity asks the server itself rather than a cached v63 probe", async () => {
    const configHome = await makeIsolatedConfigHome();
    await seedProbedProfile(configHome, 63);

    const result = await runCli({
      args: ["field", "set-sensitivity", "1", "PII", "--json"],
      configHome,
    });

    expect(result.exitCode).toBe(1);
    expect(cliErrorCategory(result.stderr)).toBe("network");
    expect(cliErrorMessage(result.stderr)).toBe(UNREACHABLE_SEED_MESSAGE);
    expect(result.stdout).toBe("");
  });

  it("set-sensitivity labels a field, or refuses where a fresh probe shows the server would drop the label", async () => {
    const result = await runCli({
      args: ["field", "set-sensitivity", String(customersEmailFieldId), "PII", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    if (serverHas("fieldDataSensitivity")) {
      expect(result.exitCode, result.stderr).toBe(0);
      expect(parseJson(result.stdout, FieldWithDataSensitivityCompact).data_sensitivity).toBe(
        "PII",
      );
      return;
    }
    const serverTag = bootstrap.server.version?.tag;
    assert(serverTag !== undefined, "a server without the column is a release with a tag");
    expect(result.exitCode).toBe(2);
    expect(cliErrorCategory(result.stderr)).toBe("capability");
    expect(cliErrorMessage(result.stderr)).toBe(sensitivityRefusal(serverTag));
    expect(result.stdout).toBe("");
  });

  const sensitivitySkip = requireServer("field › set-sensitivity", ["fieldDataSensitivity"]);

  describe.skipIf(sensitivitySkip !== null)("set-sensitivity", () => {
    async function sensitivityOf(fieldId: number): Promise<FieldDataSensitivity | null> {
      const result = await runCli({
        args: ["field", "get", String(fieldId), "--json"],
        configHome: await makeIsolatedConfigHome(),
        env: authEnv(),
      });
      expect(result.exitCode, result.stderr).toBe(0);
      return parseJson(result.stdout, FieldWithDataSensitivityCompact).data_sensitivity;
    }

    it("labels a field and get reads the label back", async () => {
      const result = await runCli({
        args: ["field", "set-sensitivity", String(customersEmailFieldId), "PII", "--json"],
        configHome: await makeIsolatedConfigHome(),
        env: authEnv(),
      });

      expect(result.exitCode, result.stderr).toBe(0);
      expect(parseJson(result.stdout, FieldWithDataSensitivityCompact)).toEqual({
        ...emailFieldCompact(),
        data_sensitivity: "PII",
      });
      expect(await sensitivityOf(customersEmailFieldId)).toBe("PII");
    });

    it("none withdraws the label", async () => {
      const labelled = await runCli({
        args: [
          "field",
          "set-sensitivity",
          String(customersEmailFieldId),
          "PII",
          "--format",
          "text",
        ],
        configHome: await makeIsolatedConfigHome(),
        env: authEnv(),
      });
      expect(labelled.exitCode, labelled.stderr).toBe(0);
      expect(labelled.stdout).toBe(`Labelled field ${customersEmailFieldId} "Email" as PII.`);

      const withdrawn = await runCli({
        args: [
          "field",
          "set-sensitivity",
          String(customersEmailFieldId),
          "none",
          "--format",
          "text",
        ],
        configHome: await makeIsolatedConfigHome(),
        env: authEnv(),
      });
      expect(withdrawn.exitCode, withdrawn.stderr).toBe(0);
      expect(withdrawn.stdout).toBe(
        `Field ${customersEmailFieldId} "Email" carries no hand-set label and is unlabelled.`,
      );
      expect(await sensitivityOf(customersEmailFieldId)).toBeNull();
    });

    it("set-sensitivity against a missing field id surfaces a 404 HttpError", async () => {
      const result = await runCli({
        args: ["field", "set-sensitivity", "9999999", "PII", "--json"],
        configHome: await makeIsolatedConfigHome(),
        env: authEnv(),
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Not found: PUT /api/field/9999999.");
    });
  });
});
