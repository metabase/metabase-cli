import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { parseJson } from "@metabase/client/json";

import {
  getQuerySchemaBundle,
  QuerySchemaBundle,
} from "../../packages/cli/src/core/schema/validate";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";

const DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema";

const RequiredKeys = z.object({ $schema: z.string(), required: z.array(z.string()) });

function configErrorEnvelope(message: string): unknown {
  return { ok: false, error: { category: "config", message, exitCode: 2 } };
}

describe("schema e2e", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function makeIsolatedConfigHome(): Promise<string> {
    const dir = await mkTempConfigHome();
    tempDirs.push(dir);
    return dir;
  }

  it("prints card create's body as TypeScript, naming the shared parameter shapes", async () => {
    const result = await runCli({
      args: ["schema", "card", "create"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.split("\n")).toEqual(
      expect.arrayContaining([
        "// Objects accept keys beyond the ones listed.",
        "type Parameter = {",
        "type ParameterMapping = {",
        "type Input = {",
        "name: string // non-empty",
        "dataset_query: Record<string, unknown> // MBQL 5, legacy MBQL, or native query",
        "display: string // non-empty",
        "visualization_settings: Record<string, unknown>",
      ]),
    );
  });

  it("prints card create's body as draft 2020-12 JSON Schema under --json", async () => {
    const result = await runCli({
      args: ["schema", "card", "create", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, RequiredKeys)).toEqual({
      $schema: DRAFT_2020_12,
      required: ["name", "dataset_query", "display", "visualization_settings"],
    });
  });

  it("prints a list command's output envelope under --output", async () => {
    const result = await runCli({
      args: ["schema", "card", "list", "--output"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout.split("\n")).toEqual(
      expect.arrayContaining([
        "type Output = {",
        "data: {",
        'type: "question" | "model" | "metric"',
        "}[]",
        'reason: "max_bytes"',
      ]),
    );
  });

  it("prints the MBQL 5 query schema as TypeScript", async () => {
    const result = await runCli({
      args: ["schema", "query"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout.split("\n").slice(-5)).toEqual([
      "type Input = {",
      '"lib/type": "mbql/query"',
      "database: database_id",
      "stages: stage[] // >=1 items",
      "}",
    ]);
  });

  it("prints the MBQL 5 schema bundle with its four common documents under --json", async () => {
    const result = await runCli({
      args: ["schema", "query", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const bundle = parseJson(result.stdout, QuerySchemaBundle);
    expect(Object.keys(bundle.defs)).toEqual([
      "id.yaml",
      "parameter.yaml",
      "ref.yaml",
      "temporal_bucketing.yaml",
    ]);
    expect(bundle).toEqual(getQuerySchemaBundle());
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
