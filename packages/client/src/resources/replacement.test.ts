import { assert, describe, expect, it } from "vitest";

import { createClient } from "../client";
import type {
  ReplacementModelWithTransformInput,
  ReplacementSourceInput,
} from "../domain/replacement";
import { ResponseShapeError } from "../errors";
import type { ClientCredentials } from "../http/transport";
import {
  captureFetch,
  type FetchScript,
  jsonResponse,
  TEST_USER_AGENT,
} from "../testing/fetch-capture";
import { CapabilityError } from "../version/preflight-error";
import { createServerProfile, type ServerProfile } from "../version/profile";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const SOURCE_SWAP: ReplacementSourceInput = {
  source_entity_id: 3,
  source_entity_type: "table",
  target_entity_id: 7,
  target_entity_type: "card",
};

const MODEL_TO_TRANSFORM: ReplacementModelWithTransformInput = {
  card_id: 7,
  transform_name: "Orders model",
  transform_target: { type: "table", database: 1, schema: "PUBLIC", name: "orders_model" },
  transform_tag_ids: [2],
};

const ID_COLUMN = {
  id: 11,
  name: "ID",
  display_name: "ID",
  base_type: "type/BigInteger",
  effective_type: "type/BigInteger",
  semantic_type: "type/PK",
};

const RUN = {
  id: 5,
  status: "started",
  is_active: true,
  source_entity_type: "table",
  source_entity_id: 3,
  target_entity_type: "card",
  target_entity_id: 7,
  progress: 0.25,
  message: null,
  user_id: 1,
  start_time: "2026-09-19T10:00:00Z",
  end_time: null,
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

const SERVER = createServerProfile({
  edition: "ee",
  version: { tag: "v1.60.0", major: 60, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: { dependencies: true },
});

const UNLICENSED_SERVER = createServerProfile({
  edition: "ee",
  version: { tag: "v1.60.0", major: 60, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: { dependencies: false },
});

const PRE_REPLACEMENT_SERVER = createServerProfile({
  edition: "ee",
  version: { tag: "v1.59.0", major: 59, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: { dependencies: true },
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

describe("replacement resource wire requests", () => {
  it("sends the source check and reads the mappings as they arrive", async () => {
    const check = {
      success: false,
      errors: ["incompatible-implicit-joins"],
      column_mappings: [
        { source: ID_COLUMN, target: { ...ID_COLUMN, id: null } },
        { source: { ...ID_COLUMN, id: 12, name: "TOTAL", display_name: "Total" } },
        { target: { ...ID_COLUMN, id: null, name: "SUM", display_name: "Sum" } },
      ],
    };
    const { mb, capture } = clientOver([jsonResponse(check)]);

    expect(await mb.replacement.checkReplaceSource(SOURCE_SWAP)).toEqual(check);
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/replacement/check-replace-source",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: JSON.stringify(SOURCE_SWAP),
      },
    ]);
  });

  it("refuses a mapping whose target column carries a base type the server does not define", async () => {
    const { mb } = clientOver([
      jsonResponse({
        success: true,
        column_mappings: [{ source: ID_COLUMN, target: { ...ID_COLUMN, base_type: "type/Nope" } }],
      }),
    ]);

    const error = await mb.replacement
      .checkReplaceSource(SOURCE_SWAP)
      .catch((caught: unknown) => caught);

    assert(error instanceof ResponseShapeError, "expected ResponseShapeError");
    expect(error.userMessage).toBe(
      "On Metabase v1.60.0 the response shape was unexpected:\n  column_mappings[0]: Invalid input",
    );
  });

  it("reads a check that answers success alone", async () => {
    const { mb } = clientOver([jsonResponse({ success: false })]);

    expect(await mb.replacement.checkReplaceSource(SOURCE_SWAP)).toEqual({ success: false });
  });

  it("sends the source replacement and reads the run id off the 202", async () => {
    const { mb, capture } = clientOver([jsonResponse({ run_id: 5 }, 202)]);

    expect(await mb.replacement.replaceSource(SOURCE_SWAP)).toEqual({ run_id: 5 });
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/replacement/replace-source",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: JSON.stringify(SOURCE_SWAP),
      },
    ]);
  });

  it("sends the model-to-transform migration with the transform target in the body", async () => {
    const { mb, capture } = clientOver([jsonResponse({ run_id: 6 }, 202)]);

    expect(await mb.replacement.replaceModelWithTransform(MODEL_TO_TRANSFORM)).toEqual({
      run_id: 6,
    });
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/replacement/replace-model-with-transform",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: JSON.stringify(MODEL_TO_TRANSFORM),
      },
    ]);
  });

  it("sends the run listing with the activity filter in the query", async () => {
    const { mb, capture } = clientOver([jsonResponse([RUN])]);

    expect(await mb.replacement.listRuns({ "is-active": true })).toEqual({
      data: [RUN],
      total: null,
    });
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/replacement/runs?is-active=true",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the run listing without a query when no filter is given", async () => {
    const { mb, capture } = clientOver([jsonResponse([])]);

    expect(await mb.replacement.listRuns()).toEqual({ data: [], total: null });
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/replacement/runs",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the run get request", async () => {
    const { mb, capture } = clientOver([jsonResponse(RUN)]);

    expect(await mb.replacement.getRun(5)).toEqual(RUN);
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/replacement/runs/5",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the cancel request and reads nothing off the acknowledgement", async () => {
    const { mb, capture } = clientOver([jsonResponse({ success: true })]);

    expect(await mb.replacement.cancelRun(5)).toBeUndefined();
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/replacement/runs/5/cancel",
        method: "POST",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("refuses a run whose status is not one the server defines", async () => {
    const { mb } = clientOver([jsonResponse({ ...RUN, status: "queued" })]);

    const error = await mb.replacement.getRun(5).catch((caught: unknown) => caught);

    assert(error instanceof ResponseShapeError, "expected ResponseShapeError");
    expect(error.userMessage).toBe(
      "On Metabase v1.60.0 the response shape was unexpected:\n  status: Invalid option: " +
        'expected one of "pending"|"started"|"succeeded"|"failed"|"canceled"|"timeout"',
    );
  });

  it("refuses before the wire on a server without the dependencies token", async () => {
    const { mb, capture } = clientOver([], UNLICENSED_SERVER);

    const error = await mb.replacement
      .checkReplaceSource(SOURCE_SWAP)
      .catch((caught: unknown) => caught);

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.developerDetail).toEqual({
      reason: "missing-token-feature",
      detail:
        "This operation requires the 'dependencies' premium feature (not enabled on this server).",
      feature: "sourceReplacement",
      since: 60,
      tokenFeature: "dependencies",
      serverVersion: "v1.60.0",
    });
    expect(capture.calls).toEqual([]);
  });

  it("refuses before the wire on a licensed server that predates replacement", async () => {
    const { mb, capture } = clientOver([], PRE_REPLACEMENT_SERVER);

    const error = await mb.replacement.listRuns().catch((caught: unknown) => caught);

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.developerDetail).toEqual({
      reason: "version-too-old",
      detail:
        "This operation requires Metabase v60+ (this server is v1.59.0). Upgrade Metabase to use it.",
      feature: "sourceReplacement",
      since: 60,
      tokenFeature: "dependencies",
      serverVersion: "v1.59.0",
    });
    expect(capture.calls).toEqual([]);
  });
});
