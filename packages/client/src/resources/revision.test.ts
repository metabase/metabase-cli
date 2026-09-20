import { assert, describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, jsonResponse, TEST_USER_AGENT, thrownBy } from "../testing/fetch-capture";
import { CapabilityError } from "../version/preflight-error";
import { createServerProfile } from "../version/profile";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const JSON_REQUEST_HEADERS = {
  accept: "application/json",
  "content-type": "application/json",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

const JSON_READ_HEADERS = {
  accept: "application/json",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

const USER = { id: 1, first_name: "Ada", last_name: "Lovelace", common_name: "Ada Lovelace" };

const REVISION = {
  id: 41,
  timestamp: "2026-09-19T20:00:00Z",
  is_creation: false,
  is_reversion: false,
  most_recent: true,
  diff: { before: { name: "Orders" }, after: { name: "Orders by month" } },
  description: 'renamed this Card from "Orders" to "Orders by month"',
  has_multiple_changes: false,
  user: USER,
};

const ROW = {
  id: 41,
  model: "Card",
  model_id: 94,
  user_id: 1,
  object: { name: "Orders by month", archived: false },
  timestamp: "2026-09-19T20:00:00Z",
  is_creation: false,
  is_reversion: false,
  most_recent: true,
};

// The first server that revisions measures and transforms, and the one before it.
const SERVER_59 = createServerProfile({
  edition: "oss",
  version: { tag: "v0.59.0", major: 59, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: null,
});

const SERVER_58 = createServerProfile({
  edition: "oss",
  version: { tag: "v0.58.0", major: 58, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: null,
});

function clientOver(responses: Array<Response>, server = SERVER_59) {
  const capture = captureFetch(responses);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
    server,
  });
  return { mb, capture };
}

describe("revision resource wire requests", () => {
  it("sends the list request with the entity and id on the path", async () => {
    const { mb, capture } = clientOver([jsonResponse([REVISION])]);

    await mb.revision.list("card", 94);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/revision/card/94",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("reports no total for the bare-array listing, which the server does not count", async () => {
    const { mb } = clientOver([jsonResponse([REVISION])]);

    expect(await mb.revision.list("card", 94)).toEqual({ data: [REVISION], total: null });
  });

  it("refuses a measure's revisions before the wire on a server without measures", async () => {
    const { mb, capture } = clientOver([jsonResponse([REVISION])], SERVER_58);

    const error = await thrownBy(() => mb.revision.list("measure", 3));

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.developerDetail).toEqual({
      reason: "version-too-old",
      detail:
        "This operation requires Metabase v59+ (this server is v0.58.0). Upgrade Metabase to use it.",
      feature: "measures",
      since: 59,
      tokenFeature: null,
      serverVersion: "v0.58.0",
    });
    expect(capture.calls).toEqual([]);
  });

  it("lists a card's revisions on the oldest supported server without asking it", async () => {
    const { mb, capture } = clientOver([jsonResponse([REVISION])], SERVER_58);

    await mb.revision.list("card", 94);

    expect(capture.calls.map((call) => call.url)).toEqual([
      "https://mb.example.com/metabase/api/revision/card/94",
    ]);
  });

  it("posts the revert with the entity, id and revision id as the body", async () => {
    const { mb, capture } = clientOver([jsonResponse(REVISION)]);

    await mb.revision.revert({ entity: "card", id: 94, revision_id: 40 });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/revision/revert",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: '{"entity":"card","id":94,"revision_id":40}',
      },
    ]);
  });

  it("reads a detailed answer as a revert that changed the entity", async () => {
    const { mb } = clientOver([jsonResponse({ ...REVISION, is_reversion: true })]);

    expect(await mb.revision.revert({ entity: "card", id: 94, revision_id: 40 })).toEqual({
      outcome: "reverted",
      revision: { ...REVISION, is_reversion: true },
    });
  });

  it("reads a bare stored row as a revert to the state the entity was already in", async () => {
    const { mb } = clientOver([jsonResponse(ROW)]);

    expect(await mb.revision.revert({ entity: "card", id: 94, revision_id: 41 })).toEqual({
      outcome: "unchanged",
      revision: ROW,
    });
  });

  it("refuses a transform revert before the wire on a server without transforms", async () => {
    const { mb, capture } = clientOver([jsonResponse(REVISION)], SERVER_58);

    const error = await thrownBy(() =>
      mb.revision.revert({ entity: "transform", id: 5, revision_id: 2 }),
    );

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.developerDetail).toEqual({
      reason: "version-too-old",
      detail:
        "This operation requires Metabase v59+ (this server is v0.58.0). Upgrade Metabase to use it.",
      feature: "transforms",
      since: 59,
      tokenFeature: null,
      serverVersion: "v0.58.0",
    });
    expect(capture.calls).toEqual([]);
  });
});
