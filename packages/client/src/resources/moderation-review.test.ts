import { assert, describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, jsonResponse, TEST_USER_AGENT } from "../testing/fetch-capture";
import { CapabilityError } from "../version/preflight-error";
import { createServerProfile } from "../version/profile";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const REVIEW = {
  id: 3,
  moderated_item_id: 42,
  moderated_item_type: "card",
  moderator_id: 1,
  status: "verified",
  text: "Looks good to me",
  most_recent: true,
  created_at: "2026-01-02T03:04:05.678Z",
  updated_at: "2026-01-02T03:04:05.678Z",
};

const JSON_REQUEST_HEADERS = {
  accept: "application/json",
  "content-type": "application/json",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

// The least server that answers this resource; the unlicensed profile flips its one token key.
const LICENSED = createServerProfile({
  edition: "ee",
  version: { tag: "v1.58.0", major: 58, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: { content_verification: true },
});

const UNLICENSED = createServerProfile({
  edition: "ee",
  version: { tag: "v1.58.0", major: 58, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: { content_verification: false },
});

async function thrownBy(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error: unknown) {
    return error;
  }
  throw new Error("expected the call to reject");
}

function clientOver(responses: Array<Response>, server = LICENSED) {
  const capture = captureFetch(responses);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
    server,
  });
  return { mb, capture };
}

describe("moderation-review resource wire requests", () => {
  it("sends the create request with the body it was given", async () => {
    const { mb, capture } = clientOver([jsonResponse(REVIEW)]);

    await mb.moderationReview.create({
      moderated_item_id: 42,
      moderated_item_type: "card",
      status: "verified",
      text: "Looks good to me",
    });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/moderation-review",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: JSON.stringify({
          moderated_item_id: 42,
          moderated_item_type: "card",
          status: "verified",
          text: "Looks good to me",
        }),
      },
    ]);
  });

  it("sends a null status as null, which the server reads as a note that clears the mark", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...REVIEW, status: null, text: "hmm" })]);

    await mb.moderationReview.create({
      moderated_item_id: 42,
      moderated_item_type: "card",
      status: null,
      text: "hmm",
    });

    expect(capture.calls.map((call) => call.body)).toEqual([
      JSON.stringify({
        moderated_item_id: 42,
        moderated_item_type: "card",
        status: null,
        text: "hmm",
      }),
    ]);
  });

  it("answers the review row the server created", async () => {
    const { mb } = clientOver([jsonResponse(REVIEW)]);

    expect(
      await mb.moderationReview.create({ moderated_item_id: 42, moderated_item_type: "card" }),
    ).toEqual(REVIEW);
  });

  it("refuses before the wire when the server grants no content_verification token", async () => {
    const { mb, capture } = clientOver([jsonResponse(REVIEW)], UNLICENSED);

    const error = await thrownBy(() =>
      mb.moderationReview.create({ moderated_item_id: 42, moderated_item_type: "card" }),
    );

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.developerDetail).toEqual({
      reason: "missing-token-feature",
      detail:
        "This operation requires the 'content_verification' premium feature (not enabled on this server).",
      feature: "contentVerification",
      since: 58,
      tokenFeature: "content_verification",
      serverVersion: "v1.58.0",
    });
    expect(capture.calls).toEqual([]);
  });
});
