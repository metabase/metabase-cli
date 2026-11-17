import { assert, describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { ClientCredentials } from "../http/transport";
import {
  captureFetch,
  type FetchScript,
  jsonResponse,
  probeResponse,
  routeMissingResponse,
  TEST_USER_AGENT,
  thrownBy,
} from "../testing/fetch-capture";
import { CapabilityError } from "../version/capability-error";
import { PROBE_PATH } from "../version/probe";
import { createServerProfile, type ServerProfile } from "../version/profile";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const TEST = {
  id: 34,
  entity_id: "abcdefghijklmnopqrstu",
  card_id: 12,
  creator_id: 1,
  name: "revenue ignores refunds",
  description: null,
  inputs: [],
  expectations: [],
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
};

const RUN_RESULT = {
  status: "passed",
  expectations: [{ name: "only paid orders count", type: "empty", status: "passed" }],
  tables: { mb_test_1a2b: "public.orders" },
};

const SERVER = createServerProfile({
  edition: "ee",
  version: { kind: "release", tag: "v1.66.0", major: 66, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: { "transforms-testing": true },
});

const LICENSED_65 = createServerProfile({
  edition: "ee",
  version: { kind: "release", tag: "v1.65.0", major: 65, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: { "transforms-testing": true },
});

function clientOver(responses: FetchScript, server: ServerProfile = SERVER) {
  const capture = captureFetch(responses);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
    server,
  });
  return { mb, capture };
}

describe("card-test resource wire requests", () => {
  it("sends the list request narrowed to one card", async () => {
    const { mb, capture } = clientOver([jsonResponse([TEST])]);

    expect(await mb.cardTest.list({ "card-id": 12 })).toEqual({ data: [TEST], total: null });
    expect(capture.calls.map((call) => call.url)).toEqual([
      "https://mb.example.com/metabase/api/ee/card-test?card-id=12",
    ]);
  });

  it("runs a test in one bodiless POST and answers its result", async () => {
    const { mb, capture } = clientOver([jsonResponse(RUN_RESULT)]);

    expect(await mb.cardTest.run(34)).toEqual(RUN_RESULT);
    expect(capture.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "POST https://mb.example.com/metabase/api/ee/card-test/34/run",
    ]);
  });

  it("explains an unrouted call on a server without card tests", async () => {
    const { mb } = clientOver([routeMissingResponse(), probeResponse(LICENSED_65)], LICENSED_65);

    const error = await thrownBy(() => mb.cardTest.list());

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.developerDetail).toEqual({
      reason: "version-too-old",
      detail:
        "This operation requires Metabase v66+ (this server is v1.65.0). Upgrade Metabase to use it.",
      feature: "cardTests",
      since: 66,
      tokenFeature: "transforms-testing",
      serverVersion: "v1.65.0",
    });
  });

  it("asks the server again for the profile it explains a refusal by", async () => {
    const { mb, capture } = clientOver(
      [routeMissingResponse(), probeResponse(LICENSED_65)],
      LICENSED_65,
    );

    await thrownBy(() => mb.cardTest.get(34));

    expect(capture.calls.map((call) => call.url)).toEqual([
      "https://mb.example.com/metabase/api/ee/card-test/34",
      `https://mb.example.com/metabase${PROBE_PATH}`,
    ]);
  });
});
