import { describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, jsonResponse, TEST_USER_AGENT } from "../testing/fetch-capture";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const USAGE = {
  input_tokens: 1200,
  output_tokens: 90,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
};

const COUNTS = {
  fields: 1,
  agree: 0,
  disagree: 0,
  new: 1,
  abstain: 0,
  dropped: 0,
  semantic_changed: 0,
};

const TABLE_RESULT = {
  table_id: 3,
  table_name: "PEOPLE",
  schema: "PUBLIC",
  database_id: 1,
  model: "anthropic/claude-haiku-4-5-20251001",
  requests: 1,
  usage: USAGE,
  sample_error: null,
  counts: COUNTS,
  fields: [
    {
      field_id: 12,
      name: "EMAIL",
      display_name: "Email",
      base_type: "type/Text",
      current: {
        data_sensitivity: null,
        human_set: false,
        state: "unscanned",
        semantic_type: "type/Email",
      },
      proposed: {
        data_sensitivity: "PII",
        confidence: "high",
        semantic_type: null,
        reasoning: "Personal email addresses.",
      },
      status: "new",
      semantic_changed: false,
    },
  ],
};

const DATABASE_RESULT = {
  database_id: 1,
  schema: null,
  tables: [TABLE_RESULT],
  counts: COUNTS,
  usage: USAGE,
  requests: 1,
  failed: 0,
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

function clientOver(responses: Array<Response>) {
  const capture = captureFetch(responses);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
  });
  return { mb, capture };
}

describe("data-sensitivity resource wire requests", () => {
  it("posts the table classification without a body", async () => {
    const { mb, capture } = clientOver([jsonResponse(TABLE_RESULT)]);

    await mb.dataSensitivity.classifyTable(3);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/data-sensitivity/table/3",
        method: "POST",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("posts the database classification with an empty body when no schema is given", async () => {
    const { mb, capture } = clientOver([jsonResponse(DATABASE_RESULT)]);

    await mb.dataSensitivity.classifyDatabase(1);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/data-sensitivity/database/1",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: "{}",
      },
    ]);
  });

  it("posts the database classification with the schema in the body", async () => {
    const { mb, capture } = clientOver([jsonResponse(DATABASE_RESULT)]);

    await mb.dataSensitivity.classifyDatabase(1, { schema: "public" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/data-sensitivity/database/1",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: '{"schema":"public"}',
      },
    ]);
  });
});
