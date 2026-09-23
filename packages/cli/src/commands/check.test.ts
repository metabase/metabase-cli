import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkRepo } from "./check";

const VALID_COLLECTION = `name: Minimal
entity_id: cOlMiNiMaL000ExAmPlx2
slug: minimal
parent_id: null
namespace: null
authority_level: null
serdes/meta:
  - id: cOlMiNiMaL000ExAmPlx2
    label: minimal
    model: Collection
`;

const COLLECTION_WITHOUT_NAME = VALID_COLLECTION.replace("name: Minimal\n", "");

describe("checkRepo", () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mb-check-"));
    mkdirSync(join(repo, "collections", "main"), { recursive: true });
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("passes a valid file", () => {
    writeFileSync(join(repo, "collections", "main", "minimal.yaml"), VALID_COLLECTION);
    expect(checkRepo(repo)).toEqual({ passed: 1, failures: [] });
  });

  it("reports an invalid file with its model and errors", () => {
    writeFileSync(join(repo, "collections", "main", "minimal.yaml"), COLLECTION_WITHOUT_NAME);
    const report = checkRepo(repo);
    expect(report.passed).toBe(0);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]?.model).toBe("Collection");
    expect(report.failures[0]?.errors.length).toBeGreaterThan(0);
  });
});
