import { describe, expect, it } from "vitest";

import { createServerProfile } from "../version/profile";
import {
  isSyncTaskFailed,
  isSyncTaskTerminal,
  syncDirtyItemSchema,
  type SyncTaskStatus,
} from "./git-sync";

const ALL_STATUSES: SyncTaskStatus[] = [
  "running",
  "successful",
  "errored",
  "cancelled",
  "timed-out",
  "conflict",
];

describe("isSyncTaskTerminal", () => {
  it("returns false only for the running status", () => {
    const terminal = ALL_STATUSES.filter((status) => isSyncTaskTerminal(status));
    expect(terminal).toEqual(["successful", "errored", "cancelled", "timed-out", "conflict"]);
  });
});

describe("isSyncTaskFailed", () => {
  it("returns true only for errored, timed-out, and conflict (not successful or cancelled)", () => {
    const failures = ALL_STATUSES.filter((status) => isSyncTaskFailed(status));
    expect(failures).toEqual(["errored", "timed-out", "conflict"]);
  });
});

const SERVER_66 = createServerProfile({
  edition: "ee",
  version: { kind: "release", tag: "v1.66.0", major: 66, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: {},
});

describe("syncDirtyItemSchema", () => {
  it("places a changed segment test in the collection of its segment's table", () => {
    const wire = {
      id: 5,
      model: "segmenttest",
      name: "keeps paid orders",
      sync_status: "create",
      data: {
        name: "keeps paid orders",
        segment: {
          table: {
            name: "orders",
            collection: { id: 3, name: "Sales", type: null, effective_ancestors: [{ id: "root" }] },
          },
        },
      },
    };

    expect(syncDirtyItemSchema(SERVER_66.features).parse(wire)).toEqual({
      id: 5,
      model: "segmenttest",
      name: "keeps paid orders",
      sync_status: "create",
      collection_id: 3,
      collection: { id: 3, name: "Sales", type: null, effective_ancestors: [] },
      model_id: null,
    });
  });
});
