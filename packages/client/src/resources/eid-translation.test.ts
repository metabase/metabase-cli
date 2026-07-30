import { describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, jsonResponse, TEST_USER_AGENT } from "../testing/fetch-capture";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const TRANSLATION = {
  entity_ids: {
    "Ss3mHTaWs8T-VLPYEeraG": { status: "ok", type: "card", id: 7 },
  },
};

const JSON_REQUEST_HEADERS = {
  accept: "application/json",
  "content-type": "application/json",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

function clientOver(responses: Array<Response>) {
  const capture = captureFetch(responses);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
  });
  return { mb, capture };
}

describe("eid-translation resource wire requests", () => {
  it("posts the entity ids grouped by model", async () => {
    const { mb, capture } = clientOver([jsonResponse(TRANSLATION)]);

    await mb.eidTranslation.translate({ entity_ids: { card: ["Ss3mHTaWs8T-VLPYEeraG"] } });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/eid-translation/translate",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: '{"entity_ids":{"card":["Ss3mHTaWs8T-VLPYEeraG"]}}',
      },
    ]);
  });

  // Request and response are keyed differently — models in, entity ids out — so the caller needs
  // the answer as the server keyed it, not the grouping it asked under.
  it("returns the lookup keyed by entity id", async () => {
    const { mb } = clientOver([jsonResponse(TRANSLATION)]);

    const result = await mb.eidTranslation.translate({
      entity_ids: { card: ["Ss3mHTaWs8T-VLPYEeraG"] },
    });

    expect(result).toEqual({
      entity_ids: { "Ss3mHTaWs8T-VLPYEeraG": { status: "ok", type: "card", id: 7 } },
    });
  });
});
