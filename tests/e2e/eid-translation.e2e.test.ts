import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { Card } from "../../src/domain/card";
import { EidTranslateResult } from "../../src/domain/eid-translation";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { E2E_CARDS } from "./seed/ids";

describe("eid translate e2e", () => {
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

  async function getCardEid(cardId: number): Promise<string> {
    // --full bypasses the compact projection so entity_id is included.
    const result = await runCli({
      args: ["card", "get", String(cardId), "--full", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const card = parseJson(result.stdout, Card);
    if (card.entity_id === null) {
      throw new Error(`seeded card ${cardId} has no entity_id`);
    }
    return card.entity_id;
  }

  it("translates a real card entity-id back to its numeric id with the --model/--eids shortcut", async () => {
    const eid = await getCardEid(E2E_CARDS.ORDERS_BY_STATUS);

    const result = await runCli({
      args: ["eid", "translate", "--model", "card", "--eids", eid, "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, EidTranslateResult)).toEqual({
      entity_ids: {
        [eid]: { id: E2E_CARDS.ORDERS_BY_STATUS, type: "card", status: "ok" },
      },
    });
  });

  it("translates an unknown but well-formed entity-id with status not-found", async () => {
    const fakeButValidEid = "Z".repeat(21);

    const result = await runCli({
      args: ["eid", "translate", "--model", "card", "--eids", fakeButValidEid, "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, EidTranslateResult)).toEqual({
      entity_ids: {
        [fakeButValidEid]: { type: "card", status: "not-found" },
      },
    });
  });

  it("rejects an unknown --model client-side with ConfigError exit code", async () => {
    const result = await runCli({
      args: ["eid", "translate", "--model", "totally-invalid", "--eids", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('invalid --model: "totally-invalid"');
  });

  it("accepts the previously-missing transform model in the closed enum (synced with backend)", async () => {
    const fakeButValidEid = "Y".repeat(21);

    const result = await runCli({
      args: ["eid", "translate", "--model", "transform", "--eids", fakeButValidEid, "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, EidTranslateResult)).toEqual({
      entity_ids: {
        [fakeButValidEid]: { type: "transform", status: "not-found" },
      },
    });
  });
});
