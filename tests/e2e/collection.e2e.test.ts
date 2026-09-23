import { assert, beforeAll, describe, expect, it } from "vitest";

import {
  COLLECTION_ITEM_FILTER_MODELS,
  COLLECTION_PINNED_STATES,
  Collection,
  CollectionCompact,
} from "@metabase/client/domain/collection";
import { parseJson } from "@metabase/client/json";

import { CollectionItemListEnvelope } from "../../packages/cli/src/commands/collection/items";
import { CollectionListEnvelope } from "../../packages/cli/src/commands/collection/list";
import { CollectionTreeResponse } from "../../packages/cli/src/commands/collection/tree";
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { runCli } from "./run-cli";
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
  is_remote_synced: false,
} as const;

const ROOT_COMPACT = {
  id: "root",
  name: "Our analytics",
  parent_id: null,
  authority_level: null,
  is_personal: false,
  is_remote_synced: false,
} as const;

const ADMIN_PERSONAL_COMPACT = {
  id: SEEDED.adminPersonalCollectionId,
  name: "Admin E2E's Personal Collection",
  description: null,
  archived: false,
  location: "/",
  parent_id: null,
  type: null,
  authority_level: null,
  is_personal: true,
  is_remote_synced: false,
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
  is_remote_synced: false,
} as const;

describe("collection e2e", () => {
  let bootstrap: E2EBootstrap;

  beforeAll(async () => {
    bootstrap = await readBootstrap();
  });

  function authEnv(): Record<string, string> {
    return {
      MB_URL: bootstrap.baseUrl,
      MB_API_KEY: bootstrap.adminApiKey,
    };
  }

  it("list returns the virtual root and the seeded E2E Default collection in compact form", async () => {
    const result = await runCli({
      args: ["collection", "list", "--json"],
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
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, CollectionListEnvelope)).toEqual({
      data: [TRASH_COMPACT],
      returned: 1,
      offset: 0,
      total: 1,
      has_more: false,
      next_offset: null,
    });
  });

  it("list --filter personal returns only the admin's personal collection", async () => {
    const result = await runCli({
      args: ["collection", "list", "--filter", "personal", "--json"],
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, CollectionListEnvelope)).toEqual({
      data: [ADMIN_PERSONAL_COMPACT],
      returned: 1,
      offset: 0,
      total: 1,
      has_more: false,
      next_offset: null,
    });
  });

  it("get returns the seeded collection by id in compact form", async () => {
    const result = await runCli({
      args: ["collection", "get", String(SEEDED.defaultCollectionId), "--json"],
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, CollectionCompact)).toEqual(DEFAULT_COMPACT);
  });

  it("get --full surfaces slug, can_write, and namespace beyond the compact projection", async () => {
    const result = await runCli({
      args: ["collection", "get", String(SEEDED.defaultCollectionId), "--json", "--full"],
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
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(
      'invalid id: "abc" (expected integer, "root", "trash", or 21-char entity id)',
    );
    expect(result.stdout).toBe("");
  });

  it("get root returns the virtual root collection from /api/collection/root", async () => {
    const result = await runCli({
      args: ["collection", "get", "root", "--json"],
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, CollectionCompact)).toEqual(ROOT_COMPACT);
  });

  it("get trash returns the trash collection from /api/collection/trash", async () => {
    const result = await runCli({
      args: ["collection", "get", "trash", "--json"],
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, CollectionCompact)).toEqual(TRASH_COMPACT);
  });

  it("get with a 21-char entity id resolves to the same collection as the integer id", async () => {
    const fetchByEntityId = await runCli({
      args: ["collection", "get", String(SEEDED.defaultCollectionId), "--json", "--full"],
      env: authEnv(),
    });
    expect(fetchByEntityId.exitCode, fetchByEntityId.stderr).toBe(0);
    const viaInt = parseJson(fetchByEntityId.stdout, Collection);
    assert(
      typeof viaInt.entity_id === "string",
      `expected entity_id to be a string on the seeded collection, got ${String(viaInt.entity_id)}`,
    );

    const fetchAgain = await runCli({
      args: ["collection", "get", "--json", "--", viaInt.entity_id],
      env: authEnv(),
    });

    expect(fetchAgain.exitCode, fetchAgain.stderr).toBe(0);
    expect(parseJson(fetchAgain.stdout, CollectionCompact)).toEqual(DEFAULT_COMPACT);
  });

  it("get against a missing collection id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["collection", "get", "9999999", "--json"],
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(cliErrorMessage(result.stderr)).toBe("Not found: GET /api/collection/9999999.");
  });

  it("items lists the seeded card and dashboard inside the default collection", async () => {
    const result = await runCli({
      args: ["collection", "items", String(SEEDED.defaultCollectionId), "--json"],
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const envelope = parseJson(result.stdout, CollectionItemListEnvelope);
    expect({
      ...envelope,
      data: [...envelope.data].toSorted((left, right) => left.model.localeCompare(right.model)),
    }).toEqual({
      data: [
        {
          id: SEEDED.ordersCardId,
          model: "card",
          name: "Orders by status",
          description: null,
          archived: false,
          collection_id: SEEDED.defaultCollectionId,
        },
        {
          id: SEEDED.ordersDashboardId,
          model: "dashboard",
          name: "Orders Overview",
          description: "E2E seeded dashboard with one orders dashcard.",
          archived: false,
          collection_id: SEEDED.defaultCollectionId,
        },
      ],
      returned: 2,
      offset: 0,
      total: 2,
      has_more: false,
      next_offset: null,
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
      offset: 0,
      total: 1,
      has_more: false,
      next_offset: null,
    });
  });

  it("items --limit caps the returned page and points at the rest", async () => {
    const result = await runCli({
      args: ["collection", "items", String(SEEDED.defaultCollectionId), "--limit", "1", "--json"],
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const envelope = parseJson(result.stdout, CollectionItemListEnvelope);
    const { data, ...meta } = envelope;
    expect(data).toHaveLength(1);
    expect(meta).toEqual({
      returned: 1,
      offset: 0,
      limit: 1,
      total: 2,
      has_more: true,
      next_offset: 1,
    });
  });

  it("items --offset resumes at next_offset and reports the end of the collection", async () => {
    const result = await runCli({
      args: [
        "collection",
        "items",
        String(SEEDED.defaultCollectionId),
        "--limit",
        "1",
        "--offset",
        "1",
        "--json",
      ],
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const envelope = parseJson(result.stdout, CollectionItemListEnvelope);
    const { data, ...meta } = envelope;
    expect(data).toHaveLength(1);
    expect(meta).toEqual({
      returned: 1,
      offset: 1,
      limit: 1,
      total: 2,
      has_more: false,
      next_offset: null,
    });
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
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(
      `invalid --models value: bogus (expected one of: ${COLLECTION_ITEM_FILTER_MODELS.join(", ")})`,
    );
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
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(
      `invalid --pinned-state value: "bogus" (expected one of: ${COLLECTION_PINNED_STATES.join(", ")})`,
    );
    expect(result.stdout).toBe("");
  });

  it("items with an unrecognized ref fails fast with ConfigError citing the accepted formats", async () => {
    const result = await runCli({
      args: ["collection", "items", "abc", "--json"],
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(
      'invalid id: "abc" (expected integer, "root", "trash", or 21-char entity id)',
    );
    expect(result.stdout).toBe("");
  });

  it("items root surfaces the seeded collection at the root level with collection_id null", async () => {
    const result = await runCli({
      args: ["collection", "items", "root", "--json"],
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
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const tree = parseJson(result.stdout, CollectionTreeResponse);
    const seeded = tree.find((node) => node.id === SEEDED.defaultCollectionId);
    assert(
      seeded !== undefined,
      `expected E2E Default in tree, got ids ${tree.map((node) => node.id).join(", ")}`,
    );
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
});
