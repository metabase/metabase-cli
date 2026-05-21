import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { CollectionItemListEnvelope } from "../../src/commands/collection/items";
import { CollectionListEnvelope } from "../../src/commands/collection/list";
import { CollectionTreeResponse } from "../../src/commands/collection/tree";
import { Collection, CollectionCompact } from "../../src/domain/collection";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { cliErrorMessage } from "./cli-error";
import { SEEDED } from "./seed/seeded";
const DEFAULT_COLLECTION_NAME = "E2E Default";

const DEFAULT_COMPACT = {
  id: SEEDED.defaultCollectionId,
  name: DEFAULT_COLLECTION_NAME,
  description: null,
  archived: false,
  location: "/",
  parent_id: null,
  type: null,
  authority_level: null,
  is_personal: false,
} as const;

const ROOT_COMPACT = {
  id: "root",
  name: "Our analytics",
  parent_id: null,
  authority_level: null,
  is_personal: false,
} as const;

const TRASH_COMPACT = {
  id: 1,
  name: "Trash",
  description: null,
  archived: false,
  location: "/",
  parent_id: null,
  type: "trash",
  authority_level: null,
  is_personal: false,
} as const;

describe("collection e2e", () => {
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

  it("list returns the virtual root and the seeded E2E Default collection in compact form", async () => {
    const result = await runCli({
      args: ["collection", "list", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const envelope = parseJson(result.stdout, CollectionListEnvelope);
    expect(envelope.data.find((collection) => collection.id === "root")).toEqual(ROOT_COMPACT);
    expect(
      envelope.data.find((collection) => collection.id === SEEDED.defaultCollectionId),
    ).toEqual(DEFAULT_COMPACT);
  });

  it("list --filter archived returns the trash collection by itself", async () => {
    const result = await runCli({
      args: ["collection", "list", "--filter", "archived", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, CollectionListEnvelope)).toEqual({
      data: [TRASH_COMPACT],
      returned: 1,
      total: 1,
    });
  });

  it("list --filter personal returns no rows for the synthetic api-key user", async () => {
    const result = await runCli({
      args: ["collection", "list", "--filter", "personal", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, CollectionListEnvelope)).toEqual({
      data: [],
      returned: 0,
      total: 0,
    });
  });

  it("get returns the seeded collection by id in compact form", async () => {
    const result = await runCli({
      args: ["collection", "get", String(SEEDED.defaultCollectionId), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, CollectionCompact)).toEqual(DEFAULT_COMPACT);
  });

  it("get --full surfaces slug, can_write, and namespace beyond the compact projection", async () => {
    const result = await runCli({
      args: ["collection", "get", String(SEEDED.defaultCollectionId), "--json", "--full"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const collection = parseJson(result.stdout, Collection);
    expect({
      id: collection.id,
      name: collection.name,
      slug: collection.slug,
      can_write: collection.can_write,
      namespace: collection.namespace,
      personal_owner_id: collection.personal_owner_id,
    }).toEqual({
      id: SEEDED.defaultCollectionId,
      name: DEFAULT_COLLECTION_NAME,
      slug: "e2e_default",
      can_write: true,
      namespace: null,
      personal_owner_id: null,
    });
  });

  it("get --format text renders the compact key/value pairs", async () => {
    const result = await runCli({
      args: ["collection", "get", String(SEEDED.defaultCollectionId), "--format", "text"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const labelPadding = "Authority".length;
    const expected = [
      `${"ID".padEnd(labelPadding)}  ${SEEDED.defaultCollectionId}`,
      `${"Name".padEnd(labelPadding)}  ${DEFAULT_COLLECTION_NAME}`,
      `${"Location".padEnd(labelPadding)}  /`,
      `${"Type".padEnd(labelPadding)}  `,
      `${"Authority".padEnd(labelPadding)}  `,
      `${"Archived".padEnd(labelPadding)}  false`,
    ].join("\n");
    expect(result.stdout.trim()).toBe(expected);
  });

  it("get with an unrecognized ref fails fast with ConfigError citing the accepted formats", async () => {
    const result = await runCli({
      args: ["collection", "get", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      'invalid id: "abc" (expected integer, "root", "trash", or 21-char entity id)',
    );
    expect(result.stdout).toBe("");
  });

  it("get root returns the virtual root collection from /api/collection/root", async () => {
    const result = await runCli({
      args: ["collection", "get", "root", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, CollectionCompact)).toEqual(ROOT_COMPACT);
  });

  it("get trash returns the trash collection from /api/collection/trash", async () => {
    const result = await runCli({
      args: ["collection", "get", "trash", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, CollectionCompact)).toEqual(TRASH_COMPACT);
  });

  it("get with a 21-char entity id resolves to the same collection as the integer id", async () => {
    const fetchByEntityId = await runCli({
      args: ["collection", "get", String(SEEDED.defaultCollectionId), "--json", "--full"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(fetchByEntityId.exitCode, fetchByEntityId.stderr).toBe(0);
    const viaInt = parseJson(fetchByEntityId.stdout, Collection);
    if (typeof viaInt.entity_id !== "string") {
      throw new Error(
        `expected entity_id to be a string on the seeded collection, got ${String(viaInt.entity_id)}`,
      );
    }

    const fetchAgain = await runCli({
      args: ["collection", "get", "--json", "--", viaInt.entity_id],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(fetchAgain.exitCode, fetchAgain.stderr).toBe(0);
    expect(parseJson(fetchAgain.stdout, CollectionCompact)).toEqual(DEFAULT_COMPACT);
  });

  it("get against a missing collection id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["collection", "get", "9999999", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Not found: GET /api/collection/9999999.");
  });

  it("items lists the seeded card and dashboard inside the default collection", async () => {
    const result = await runCli({
      args: ["collection", "items", String(SEEDED.defaultCollectionId), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const envelope = parseJson(result.stdout, CollectionItemListEnvelope);
    expect(envelope.data.find((item) => item.model === "dashboard")).toEqual({
      id: SEEDED.ordersDashboardId,
      model: "dashboard",
      name: "Orders Overview",
      description: "E2E seeded dashboard with one orders dashcard.",
      archived: false,
      collection_id: SEEDED.defaultCollectionId,
    });
    expect(envelope.data.find((item) => item.model === "card")).toEqual({
      id: SEEDED.ordersCardId,
      model: "card",
      name: "Orders by status",
      description: null,
      archived: false,
      collection_id: SEEDED.defaultCollectionId,
    });
    expect({ returned: envelope.returned, total: envelope.total }).toEqual({
      returned: 2,
      total: 2,
    });
  });

  it("items --models card filters the result to cards only", async () => {
    const result = await runCli({
      args: [
        "collection",
        "items",
        String(SEEDED.defaultCollectionId),
        "--models",
        "card",
        "--json",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, CollectionItemListEnvelope)).toEqual({
      data: [
        {
          id: SEEDED.ordersCardId,
          model: "card",
          name: "Orders by status",
          description: null,
          archived: false,
          collection_id: SEEDED.defaultCollectionId,
        },
      ],
      returned: 1,
      total: 1,
    });
  });

  it("items --limit caps the returned page", async () => {
    const result = await runCli({
      args: ["collection", "items", String(SEEDED.defaultCollectionId), "--limit", "1", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const envelope = parseJson(result.stdout, CollectionItemListEnvelope);
    const { data, ...meta } = envelope;
    expect(data).toHaveLength(1);
    expect(meta).toEqual({ returned: 1, limit: 1 });
  });

  it("items --models rejects an unknown model with ConfigError", async () => {
    const result = await runCli({
      args: [
        "collection",
        "items",
        String(SEEDED.defaultCollectionId),
        "--models",
        "bogus",
        "--json",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("invalid --models value: bogus");
    expect(result.stdout).toBe("");
  });

  it("items --pinned-state rejects an unknown preset with ConfigError", async () => {
    const result = await runCli({
      args: [
        "collection",
        "items",
        String(SEEDED.defaultCollectionId),
        "--pinned-state",
        "bogus",
        "--json",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid --pinned-state value: "bogus"');
    expect(result.stdout).toBe("");
  });

  it("items with an unrecognized ref fails fast with ConfigError citing the accepted formats", async () => {
    const result = await runCli({
      args: ["collection", "items", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      'invalid id: "abc" (expected integer, "root", "trash", or 21-char entity id)',
    );
    expect(result.stdout).toBe("");
  });

  it("items on a freshly-created empty collection returns an empty envelope (server total: null)", async () => {
    const configHome = await makeIsolatedConfigHome();
    const createResult = await runCli({
      args: ["collection", "create", "--json"],
      stdin: JSON.stringify({
        name: `e2e_empty_collection_${Date.now()}`,
        parent_id: SEEDED.defaultCollectionId,
      }),
      configHome,
      env: authEnv(),
    });
    expect(createResult.exitCode, createResult.stderr).toBe(0);
    const created = parseJson(createResult.stdout, Collection);

    const itemsResult = await runCli({
      args: ["collection", "items", String(created.id), "--json"],
      configHome,
      env: authEnv(),
    });

    expect(itemsResult.exitCode, itemsResult.stderr).toBe(0);
    expect(parseJson(itemsResult.stdout, CollectionItemListEnvelope)).toEqual({
      data: [],
      returned: 0,
      total: 0,
    });
  });

  it("items root surfaces the seeded collection at the root level with collection_id null", async () => {
    const result = await runCli({
      args: ["collection", "items", "root", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const envelope = parseJson(result.stdout, CollectionItemListEnvelope);
    expect(envelope.data.find((item) => item.id === SEEDED.defaultCollectionId)).toEqual({
      id: SEEDED.defaultCollectionId,
      model: "collection",
      name: DEFAULT_COLLECTION_NAME,
      description: null,
      archived: false,
      collection_id: null,
    });
  });

  it("tree returns the seeded collection at the root level with empty children", async () => {
    const result = await runCli({
      args: ["collection", "tree"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const tree = parseJson(result.stdout, CollectionTreeResponse);
    const seeded = tree.find((node) => node.id === SEEDED.defaultCollectionId);
    if (seeded === undefined) {
      throw new Error(
        `expected E2E Default in tree, got ids ${tree.map((node) => node.id).join(", ")}`,
      );
    }
    expect({
      id: seeded.id,
      name: seeded.name,
      location: seeded.location,
      type: seeded.type,
      childrenLength: seeded.children.length,
      here: seeded.here,
    }).toEqual({
      id: SEEDED.defaultCollectionId,
      name: DEFAULT_COLLECTION_NAME,
      location: "/",
      type: null,
      childrenLength: 0,
      here: ["card"],
    });
  });

  it("create round-trips a new collection and surfaces it on the list", async () => {
    const createResult = await runCli({
      args: ["collection", "create", "--json"],
      stdin: JSON.stringify({
        name: "e2e_new_collection",
        description: "created in test",
        parent_id: SEEDED.defaultCollectionId,
      }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(createResult.exitCode, createResult.stderr).toBe(0);
    const created = parseJson(createResult.stdout, Collection);
    expect({
      name: created.name,
      description: created.description,
      archived: created.archived,
      location: created.location,
      type: created.type,
      authority_level: created.authority_level,
    }).toEqual({
      name: "e2e_new_collection",
      description: "created in test",
      archived: false,
      location: `/${SEEDED.defaultCollectionId}/`,
      type: null,
      authority_level: null,
    });

    const listResult = await runCli({
      args: ["collection", "list", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(listResult.exitCode, listResult.stderr).toBe(0);
    const listEnvelope = parseJson(listResult.stdout, CollectionListEnvelope);
    const newRow = listEnvelope.data.find((row) => row.id === created.id);
    expect(newRow).toEqual({
      id: created.id,
      name: "e2e_new_collection",
      description: "created in test",
      archived: false,
      location: `/${SEEDED.defaultCollectionId}/`,
      parent_id: SEEDED.defaultCollectionId,
      type: null,
      authority_level: null,
      is_personal: false,
    });
  });

  it("create with a body missing the required name field fails on Zod validation", async () => {
    const result = await runCli({
      args: ["collection", "create", "--json"],
      stdin: JSON.stringify({ description: "no name here" }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("request body: value did not match expected schema");
    expect(result.stdout).toBe("");
  });
});
