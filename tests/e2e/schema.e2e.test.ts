import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { parseJson } from "@metabase/client/json";

import { schemaJson, schemaTypeScript } from "../../packages/cli/src/commands/schema";
import { getQuerySchemaBundle } from "../../packages/cli/src/core/schema/validate";
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { serverHas } from "./server-gate";

const SENSITIVITY_NOTE = "// needs fieldDataSensitivity (v64+)";

function configErrorEnvelope(message: string): unknown {
  return { ok: false, error: { category: "config", message, exitCode: 2 } };
}

describe("schema e2e", () => {
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

  it("prints card create's body as TypeScript", async () => {
    const result = await runCli({
      args: ["schema", "card", "create"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      await schemaTypeScript(["card", "create"], "input", { server: null }),
    );
  });

  it("prints card create's body as JSON Schema under --json", async () => {
    const result = await runCli({
      args: ["schema", "card", "create", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, z.unknown())).toEqual(
      await schemaJson(["card", "create"], "input"),
    );
  });

  it("prints a list command's output envelope as TypeScript under --output", async () => {
    const result = await runCli({
      args: ["schema", "card", "list", "--output"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toBe(
      await schemaTypeScript(["card", "list"], "output", { server: null }),
    );
  });

  it("prints the MBQL 5 query schema as TypeScript", async () => {
    const result = await runCli({
      args: ["schema", "query"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toBe(await schemaTypeScript(["query"], "input", { server: null }));
  });

  it("prints the MBQL 5 schema bundle as it is under --json", async () => {
    const result = await runCli({
      args: ["schema", "query", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, z.unknown())).toEqual(getQuerySchemaBundle());
  });

  it("judges a gated field against the server the profile's login probed", async () => {
    const configHome = await makeIsolatedConfigHome();
    const login = await runCli({
      args: ["auth", "login", "--url", bootstrap.baseUrl, "--api-key", bootstrap.adminApiKey],
      configHome,
    });
    expect(login.exitCode, login.stderr).toBe(0);

    const result = await runCli({ args: ["schema", "field", "update"], configHome });

    expect(result.exitCode, result.stderr).toBe(0);
    const note = serverHas("fieldDataSensitivity")
      ? SENSITIVITY_NOTE
      : `${SENSITIVITY_NOTE}; this server rejects it`;
    expect(result.stdout.split("\n")).toContain(note);
  });

  it("refuses a command group, naming its commands", async () => {
    const result = await runCli({
      args: ["schema", "card"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(parseJson(result.stderr, z.unknown())).toEqual(
      configErrorEnvelope(
        "card is a command group; name one of its commands: list, get, query, alerts, create, update, verify, archive",
      ),
    );
  });

  it("refuses the body of a command that takes none, pointing at --output", async () => {
    const result = await runCli({
      args: ["schema", "card", "get"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(parseJson(result.stderr, z.unknown())).toEqual(
      configErrorEnvelope(
        "card get takes no JSON body, so it has no input schema; pass --output for the schema of what it prints",
      ),
    );
  });
});
