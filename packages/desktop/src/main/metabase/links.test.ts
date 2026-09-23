import { describe, expect, it } from "vitest";

import { contentEntity, contentUrl, translationRequest } from "./links";

const TRANSFORM_YAML = `name: Clean orders
entity_id: tRaNsFoRm00000000000a
serdes/meta:
  - id: tRaNsFoRm00000000000a
    label: clean_orders
    model: Transform
`;

const DASHCARD_OWNED_CARD_YAML = `name: Revenue
entity_id: cArD0000000000000000a
serdes/meta:
  - id: dAsHbOaRd00000000000a
    model: Dashboard
  - id: cArD0000000000000000a
    model: Card
`;

const MODEL_YAML = `name: Orders model
entity_id: mOdEl000000000000000a
type: model
serdes/meta:
  - id: mOdEl000000000000000a
    model: Card
`;

const TABLE_YAML = `name: ORDERS
db_id: Sample Database
serdes/meta:
  - id: Sample Database
    model: Database
  - id: ORDERS
    model: Table
`;

describe("contentEntity", () => {
  it("reads a transform's kind, entity id and name", () => {
    expect(contentEntity(TRANSFORM_YAML)).toEqual({
      kind: "transform",
      entityId: "tRaNsFoRm00000000000a",
      name: "Clean orders",
    });
  });

  it("takes the kind from the last serdes/meta entry, so a card inside a dashboard is a question", () => {
    expect(contentEntity(DASHCARD_OWNED_CARD_YAML)).toEqual({
      kind: "question",
      entityId: "cArD0000000000000000a",
      name: "Revenue",
    });
  });

  it("names a card by its type", () => {
    expect(contentEntity(MODEL_YAML)).toEqual({
      kind: "model",
      entityId: "mOdEl000000000000000a",
      name: "Orders model",
    });
  });

  it("reads a table, which Metabase addresses by path and not by entity id", () => {
    expect(contentEntity(TABLE_YAML)).toEqual({ kind: "table", entityId: null, name: "ORDERS" });
  });

  it("is no link for YAML that is not Metabase content", () => {
    expect(contentEntity("jobs:\n  build: {}\n")).toBeNull();
  });
});

describe("contentUrl", () => {
  it("opens a transform in the data studio and tolerates a trailing slash on the instance", () => {
    expect(
      contentUrl({ url: "http://metabase.test/", worktree: { kind: "absent" } }, "transform", 7),
    ).toBe("http://metabase.test/data-studio/transforms/7");
  });

  it("opens a metric on its own page, in the session's worktree", () => {
    const worktree = { kind: "ready", id: 7, branch: "feature" } as const;
    expect(contentUrl({ url: "http://metabase.test", worktree }, "metric", 12)).toBe(
      "http://metabase.test/metric/12?worktree=7",
    );
  });
});

describe("translationRequest", () => {
  it("asks for the kinds with a page and leaves out the rest", () => {
    expect(
      translationRequest([
        { kind: "model", entityId: "mOdEl000000000000000a", name: "Orders model" },
        { kind: "segment", entityId: "sEgMeNt0000000000000a", name: "Big orders" },
        { kind: "table", entityId: null, name: "ORDERS" },
      ]),
    ).toEqual({ entity_ids: { card: ["mOdEl000000000000000a"] } });
  });
});
