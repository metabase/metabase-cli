import { assert, describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { PythonTestRunInput } from "../domain/transform-python";
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

const LIBRARY = {
  path: "common.py",
  source: "def double(df):\n    return df * 2\n",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

const TEST_RUN: PythonTestRunInput = {
  code: "def transform(orders):\n    return orders\n",
  source_tables: [{ alias: "orders", database_id: 1, schema: "public", table_id: 12 }],
  output_row_limit: 10,
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

// The first generation whose test run takes source tables as entries, licensed for Python
// transforms.
const SERVER = createServerProfile({
  edition: "ee",
  version: { tag: "v1.60.0", major: 60, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: { "transforms-python": true },
});

const UNLICENSED_SERVER = createServerProfile({
  edition: "ee",
  version: { tag: "v1.60.0", major: 60, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: { "transforms-python": false },
});

// Serves the library, but its test run takes source tables as an alias-to-id map.
const MAP_SOURCE_TABLES_SERVER = createServerProfile({
  edition: "ee",
  version: { tag: "v1.59.0", major: 59, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: { "transforms-python": true },
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

describe("transform-python resource wire requests", () => {
  it("sends the library request with the path encoded", async () => {
    const { mb, capture } = clientOver([jsonResponse(LIBRARY)]);

    expect(await mb.transformPython.getLibrary("common.py")).toEqual(LIBRARY);
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/transforms-python/library/common.py",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the library update with the source in the body", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...LIBRARY, id: 1 })]);

    expect(await mb.transformPython.updateLibrary("common", { source: LIBRARY.source })).toEqual({
      ...LIBRARY,
      id: 1,
    });
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/transforms-python/library/common",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: JSON.stringify({ source: LIBRARY.source }),
      },
    ]);
  });

  it("sends the test run and reads a succeeded outcome off the output", async () => {
    const output = { cols: [{ name: "id" }], rows: [[1], [2]] };
    const { mb, capture } = clientOver([jsonResponse({ logs: "ok", output })]);

    expect(await mb.transformPython.testRun(TEST_RUN)).toEqual({
      outcome: "succeeded",
      logs: "ok",
      output,
    });
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/transforms-python/test-run",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: JSON.stringify(TEST_RUN),
      },
    ]);
  });

  it("reads a failed outcome off the error", async () => {
    const { mb } = clientOver([
      jsonResponse({ logs: "Traceback", error: { message: "NameError: name 'x' is not defined" } }),
    ]);

    expect(await mb.transformPython.testRun(TEST_RUN)).toEqual({
      outcome: "failed",
      logs: "Traceback",
      error: { message: "NameError: name 'x' is not defined" },
    });
  });

  it("refuses a test run that answers neither output nor error", async () => {
    const { mb } = clientOver([jsonResponse({ logs: "ok" })]);

    const error = await mb.transformPython.testRun(TEST_RUN).catch((caught: unknown) => caught);

    assert(error instanceof ResponseShapeError, "expected ResponseShapeError");
    expect(error.userMessage).toBe(
      "On Metabase v1.60.0 the response shape was unexpected:\n  Invalid input",
    );
  });

  it("refuses before the wire on a server without the Python transforms token", async () => {
    const { mb, capture } = clientOver([jsonResponse(LIBRARY)], UNLICENSED_SERVER);

    const error = await mb.transformPython.getLibrary("common").catch((caught: unknown) => caught);

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.developerDetail).toEqual({
      reason: "missing-token-feature",
      detail:
        "This operation requires the 'transforms-python' premium feature (not enabled on this server).",
      feature: "pythonLibrary",
      since: 58,
      tokenFeature: "transforms-python",
      serverVersion: "v1.60.0",
    });
    expect(capture.calls).toEqual([]);
  });

  it("refuses a test run before the wire on a server that takes source tables as a map", async () => {
    const { mb, capture } = clientOver([jsonResponse({ logs: "ok" })], MAP_SOURCE_TABLES_SERVER);

    const error = await mb.transformPython.testRun(TEST_RUN).catch((caught: unknown) => caught);

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.developerDetail).toEqual({
      reason: "version-too-old",
      detail:
        "This operation requires Metabase v60+ (this server is v1.59.0). Upgrade Metabase to use it.",
      feature: "pythonTestRun",
      since: 60,
      tokenFeature: "transforms-python",
      serverVersion: "v1.59.0",
    });
    expect(capture.calls).toEqual([]);
  });
});
