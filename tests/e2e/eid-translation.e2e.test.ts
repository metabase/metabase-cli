import { afterEach, assert, beforeAll, describe, expect, it } from "vitest";

import { Card } from "../../src/domain/card";
import { EidTranslateResult } from "../../src/domain/eid-translation";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { cliErrorMessage } from "./cli-error";
import { SEEDED } from "./seed/seeded";
import { requireServer } from "./server-gate";

const transformsSkip = requireServer({ minVersion: 59 });

describe("eid e2e", () => {
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

  async function getCardEid(cardId: number): Promise<string> {
    // --full bypasses the compact projection so entity_id is included.
    const result = await runCli({
      args: ["card", "get", String(cardId), "--full", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const card = parseJson(result.stdout, Card);
    assert(card.entity_id !== null, `seeded card ${cardId} has no entity_id`);
    return card.entity_id;
  }

  // A card's entity_id is a random NanoID that can start with `-`, which the positional `<eids>`
  // form would misparse as a flag (~1/64 of ids). Translate via --body so the round-trip is
  // deterministic regardless of the seeded id; the positional shortcut is covered by the fake-eid
  // test below, whose id never leads with `-`.
  it("translates a real card entity-id back to its numeric id via --body", async () => {
    const eid = await getCardEid(SEEDED.ordersCardId);

    const result = await runCli({
      args: ["eid", "--body", JSON.stringify({ entity_ids: { card: [eid] } }), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, EidTranslateResult)).toEqual({
      entity_ids: {
        [eid]: { id: SEEDED.ordersCardId, type: "card", status: "ok" },
      },
    });
  });

  it("translates an unknown but well-formed entity-id with status not-found", async () => {
    const fakeButValidEid = "Z".repeat(21);

    const result = await runCli({
      args: ["eid", "--model", "card", fakeButValidEid, "--json"],
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
      args: ["eid", "--model", "totally-invalid", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid --model: "totally-invalid"');
  });

  it.skipIf(transformsSkip !== null)(
    "accepts the previously-missing transform model in the closed enum (synced with backend)",
    async () => {
      const fakeButValidEid = "Y".repeat(21);

      const result = await runCli({
        args: ["eid", "--model", "transform", fakeButValidEid, "--json"],
        configHome: await makeIsolatedConfigHome(),
        env: authEnv(),
      });

      expect(result.exitCode, result.stderr).toBe(0);
      expect(parseJson(result.stdout, EidTranslateResult)).toEqual({
        entity_ids: {
          [fakeButValidEid]: { type: "transform", status: "not-found" },
        },
      });
    },
  );
});
