import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DashboardCompact } from "../../src/domain/dashboard";
import { ParameterValues } from "../../src/domain/parameter";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { cliErrorMessage } from "./cli-error";
import { SEEDED } from "./seed/seeded";

const CATEGORY_PARAM = {
  id: "cat_param",
  name: "Category",
  slug: "category",
  type: "string/=",
  sectionId: "string",
  required: false,
  default: null,
  values_query_type: "list",
  values_source_type: "static-list",
  values_source_config: { values: ["Widget", "Gadget", "Gizmo"] },
} as const;

describe("dashboard parameter-values e2e", () => {
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
      MB_URL: bootstrap.baseUrl,
      MB_API_KEY: bootstrap.adminApiKey,
    };
  }

  async function createDashboard(body: unknown): Promise<number> {
    const result = await runCli({
      args: ["dashboard", "create", "--json"],
      stdin: JSON.stringify(body),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    return parseJson(result.stdout, DashboardCompact).id;
  }

  function createParamDashboard(): Promise<number> {
    return createDashboard({
      name: "e2e_params_dashboard",
      collection_id: SEEDED.defaultCollectionId,
      parameters: [CATEGORY_PARAM],
    });
  }

  it("parameter-values returns the static-list values for the parameter", async () => {
    const id = await createParamDashboard();
    const result = await runCli({
      args: ["dashboard", "parameter-values", String(id), "cat_param", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, ParameterValues)).toEqual({
      values: [["Widget"], ["Gadget"], ["Gizmo"]],
      has_more_values: false,
    });
  });

  it("parameter-values --query narrows the static-list values case-insensitively", async () => {
    const id = await createParamDashboard();
    const result = await runCli({
      args: ["dashboard", "parameter-values", String(id), "cat_param", "--query", "gad", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, ParameterValues)).toEqual({
      values: [["Gadget"]],
      has_more_values: false,
    });
  });

  it("parameter-values against a missing dashboard id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["dashboard", "parameter-values", "9999999", "cat_param", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Not found: GET /api/dashboard/9999999/params/cat_param/values.",
    );
  });

  it("parameter-values for an unknown parameter id surfaces a 400 HttpError", async () => {
    const id = await createParamDashboard();
    const result = await runCli({
      args: ["dashboard", "parameter-values", String(id), "nope", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(cliErrorMessage(result.stderr)).toContain(
      'Dashboard does not have a parameter with the ID "nope"',
    );
  });

  it("parameter-values with an empty parameter id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["dashboard", "parameter-values", "1", "", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain("parameter-id must not be empty");
    expect(result.stdout).toBe("");
  });

  it("parameter-values with a non-integer dashboard id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["dashboard", "parameter-values", "abc", "cat_param", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain(
      'invalid dashboard-id: "abc" (expected integer)',
    );
    expect(result.stdout).toBe("");
  });
});
