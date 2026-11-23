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

const SALES = { id: 3, name: "Sales", type: null, effective_ancestors: [{ id: "root" }] };

describe("syncDirtyItemSchema for a changed action test", () => {
  it("places the test in the collection of its action's model", () => {
    const wire = {
      id: 5,
      model: "actiontest",
      name: "refunds one order",
      sync_status: "update",
      data: {
        id: 5,
        name: "refunds one order",
        action_id: 9,
        action: { id: 9, name: "Refund", model: { id: 4, name: "Orders", collection: SALES } },
      },
    };

    expect(syncDirtyItemSchema(SERVER_66.features).parse(wire)).toEqual({
      id: 5,
      model: "actiontest",
      name: "refunds one order",
      sync_status: "update",
      collection_id: 3,
      collection: { id: 3, name: "Sales", type: null, effective_ancestors: [] },
      model_id: null,
    });
  });
});
