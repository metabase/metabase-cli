import { describe, expect, it, vi } from "vitest";

import type { DependencyNode } from "@metabase/client/domain/dependency";

import { lineageType, walkDependents } from "./lineage";

function node(id: number, type: DependencyNode["type"], data: DependencyNode["data"] = {}) {
  return { id, type, data };
}

describe("lineage", () => {
  it("uses formal card subtypes for questions, models, and metrics", () => {
    expect(lineageType(node(1, "card", { type: "model" }))).toBe("model");
    expect(lineageType(node(2, "card", { type: "metric" }))).toBe("metric");
    expect(lineageType(node(3, "card", { type: "question" }))).toBe("question");
  });

  it("walks breadth-first, keeps shortest paths, and breaks cycles", async () => {
    const read = vi.fn(async (type: DependencyNode["type"], id: number) => {
      const graph: Record<string, DependencyNode[]> = {
        "table:1": [
          node(2, "card", { type: "model", name: "Orders model" }),
          node(3, "card", { name: "Question" }),
        ],
        "card:2": [node(4, "dashboard", { name: "Operations" })],
        "card:3": [node(4, "dashboard", { name: "Operations" })],
        "dashboard:4": [node(2, "card", { type: "model", name: "Orders model" })],
      };
      return graph[`${type}:${id}`] ?? [];
    });

    const result = await walkDependents(read, { type: "table", id: 1 });

    expect(result.map(({ type, id, distance }) => ({ type, id, distance }))).toEqual([
      { type: "model", id: 2, distance: 1 },
      { type: "question", id: 3, distance: 1 },
      { type: "dashboard", id: 4, distance: 2 },
    ]);
    expect(result[2]?.path).toEqual([
      { type: "table", id: 1 },
      { type: "card", id: 2 },
      { type: "dashboard", id: 4 },
    ]);
  });
});
