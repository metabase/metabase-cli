import { describe, expect, it } from "vitest";

import type {
  DataSensitivityDatabaseResult,
  DataSensitivityTableResult,
} from "@metabase/client/domain/data-sensitivity";

import { applyProjection } from "../../output/projection";
import {
  dataSensitivityDatabaseView,
  dataSensitivityTableView,
} from "../../output/views/data-sensitivity";
import { getMetabaseAugment } from "../../runtime/command-augment";
import type { ResourceView } from "../../output/view";

import scanDb from "./scan-db";
import scanTable from "./scan-table";

const TABLE: DataSensitivityTableResult = {
  table_id: 3,
  table_name: "PEOPLE",
  schema: "PUBLIC",
  database_id: 1,
  model: "anthropic/claude-haiku-4-5-20251001",
  requests: 1,
  usage: {
    input_tokens: 1,
    output_tokens: 1,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    total_tokens: 2,
  },
  sample_error: null,
  counts: { fields: 0, agree: 0, disagree: 0, new: 0, abstain: 0, dropped: 0, semantic_changed: 0 },
  fields: [],
};

const DATABASE: DataSensitivityDatabaseResult = {
  database_id: 1,
  schema: null,
  tables: [TABLE],
  counts: TABLE.counts,
  usage: TABLE.usage,
  requests: 1,
  failed: 0,
};

// The projection walks plain objects only, so an example advertising a path through `tables` or
// `fields` would throw for every user who copied it.
function fieldsPathsInExamples(cmd: object): string[][] {
  const examples = getMetabaseAugment(cmd)?.examples ?? [];
  return examples.flatMap((example) => {
    const tokens = example.split(/\s+/);
    const flagIndex = tokens.indexOf("--fields");
    const value = flagIndex === -1 ? undefined : tokens[flagIndex + 1];
    return value === undefined ? [] : [value.split(",")];
  });
}

function projectsEveryExample<T>(cmd: object, fixture: T, view: ResourceView<T>): void {
  const paths = fieldsPathsInExamples(cmd);
  expect(paths.length).toBeGreaterThan(0);
  for (const fields of paths) {
    expect(() => applyProjection(fixture, view, false, fields)).not.toThrow();
  }
}

describe("data-sensitivity --fields examples", () => {
  it("scan-db advertises only paths the projection can resolve", () => {
    projectsEveryExample(scanDb, DATABASE, dataSensitivityDatabaseView);
  });

  it("scan-table advertises only paths the projection can resolve", () => {
    projectsEveryExample(scanTable, TABLE, dataSensitivityTableView);
  });
});
