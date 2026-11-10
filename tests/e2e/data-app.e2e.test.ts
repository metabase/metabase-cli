import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createClient } from "@metabase/client";
import { parseJson } from "@metabase/client/json";

import { SdkVersionResult } from "../../packages/cli/src/commands/data-app/sdk-version";
import { USER_AGENT } from "../../packages/cli/src/core/user-agent";
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { type RegistryFixture, startRegistryFixture } from "./registry-fixture";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { SEEDED } from "./seed/seeded";
import { requireRelease, requireServer, stackRelease } from "./server-gate";

const releaseSkip = requireRelease("data-app sdk-version › release");

describe.skipIf(releaseSkip !== null)("data-app sdk-version e2e", () => {
  let bootstrap: E2EBootstrap;
  let fixture: RegistryFixture;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    bootstrap = await readBootstrap();
    fixture = await startRegistryFixture({ latest: "0.1.0" });
  });

  afterAll(async () => {
    await fixture.close();
  });

  afterEach(async () => {
    fixture.reset();
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function sdkVersion(format: "json" | "text") {
    const configHome = await mkTempConfigHome();
    tempDirs.push(configHome);
    return runCli({
      args: ["data-app", "sdk-version", "--format", format, "--registry", fixture.url],
      configHome,
      env: { MB_URL: bootstrap.baseUrl, MB_API_KEY: bootstrap.adminApiKey },
    });
  }

  it("answers the SDK tag of the server's major, with the server's version", async () => {
    const { tag, major } = stackRelease();
    fixture.setDistTags({ latest: `0.${major}.3`, [`${major}-stable`]: `0.${major}.3` });

    const result = await sdkVersion("json");

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, SdkVersionResult)).toEqual({
      metabaseVersion: tag,
      tag: `${major}-stable`,
      version: `0.${major}.3`,
    });
  });

  it("prints the bare tag as text, so the install composes in a shell", async () => {
    const { major } = stackRelease();
    fixture.setDistTags({ latest: `0.${major}.3`, [`${major}-stable`]: `0.${major}.3` });

    const result = await sdkVersion("text");

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toBe(`${major}-stable`);
  });
});

const APP_SLUG = "order-desk";

function appBundle(questionEntityId: string, actionEntityId: string): string {
  return [
    `const orders = { entityId: ${JSON.stringify(questionEntityId)} };`,
    `const updateOrder = { entityId: ${JSON.stringify(actionEntityId)}, kind: "row/update" };`,
    "export default () => ({ component: () => null, queries: [orders], actions: [updateOrder] });",
  ].join("\n");
}

const lifecycleSkip = requireServer("data-app › client lifecycle", ["dataApps", "dataAppEditing"]);

describe.skipIf(lifecycleSkip !== null)("data-app client lifecycle e2e", () => {
  let mb: ReturnType<typeof createClient>;

  beforeAll(async () => {
    const bootstrap = await readBootstrap();
    mb = createClient(
      { url: bootstrap.baseUrl, credential: { kind: "apiKey", apiKey: bootstrap.adminApiKey } },
      { userAgent: USER_AGENT },
    );
  });

  it("creates an app, fills its collection with a question and an action, and serves the bundle it was sent", async () => {
    await mb.database.update(SEEDED.warehouseDbId, {
      settings: { "database-enable-actions": true },
    });

    const app = await mb.dataApp.create({ slug: APP_SLUG, name: "Order desk" });
    expect(app).toEqual({
      id: expect.any(Number),
      entity_id: expect.any(String),
      slug: APP_SLUG,
      name: "Order desk",
      description: null,
      version: 1,
      outdated: false,
      bundle_path: "dist/index.js",
      enabled: true,
      allowed_hosts: [],
      resource_collection_id: expect.any(Number),
      bundle_hash: expect.any(String),
      created_at: expect.any(String),
      updated_at: expect.any(String),
    });

    const question = await mb.card.create({
      name: "Orders",
      type: "question",
      display: "table",
      visualization_settings: {},
      collection_id: app.resource_collection_id,
      dataset_query: {
        type: "query",
        database: SEEDED.warehouseDbId,
        query: { "source-table": SEEDED.tables.orders },
      },
    });
    const action = await mb.dataAction.create({
      name: "Update order",
      type: "implicit",
      kind: "row/update",
      table_id: SEEDED.tables.orders,
      collection_id: app.resource_collection_id,
    });
    expect([question.collection_id, action.collection_id]).toEqual([
      app.resource_collection_id,
      app.resource_collection_id,
    ]);

    const bundle = appBundle(String(question.entity_id), String(action.entity_id));
    const uploaded = await mb.dataApp.updateBundle(APP_SLUG, bundle);
    expect(uploaded.bundle_hash).not.toBe(app.bundle_hash);

    expect(await mb.dataApp.getBundle(APP_SLUG)).toBe(bundle);
  });
});
