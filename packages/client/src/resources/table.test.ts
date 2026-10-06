import { assert, describe, expect, it } from "vitest";

import { createClient } from "../client";
import { ConfigError, PartialWriteError } from "../errors";
import type { ClientCredentials } from "../http/transport";
import {
  captureFetch,
  jsonResponse,
  probeResponse,
  routeMissingResponse,
  TEST_USER_AGENT,
  thrownBy,
} from "../testing/fetch-capture";
import { CapabilityError } from "../version/preflight-error";
import { PROBE_PATH } from "../version/probe";
import { createServerProfile } from "../version/profile";

import type { CsvFile } from "./csv-upload";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const FIELD = {
  id: 101,
  table_id: 11,
  name: "total",
  display_name: "Total",
  description: null,
  base_type: "type/Float",
  semantic_type: null,
  fk_target_field_id: null,
};

const TABLE = {
  id: 11,
  name: "orders",
  display_name: "Orders",
  description: null,
  db_id: 1,
  schema: "public",
  entity_type: "entity/TransactionTable",
  active: true,
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

const BINARY_READ_HEADERS = {
  accept: "*/*",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

const CSV_TEXT = "id,total\n1,9\n";

const CSV_FILE: CsvFile = {
  filename: "rows.csv",
  bytes: new TextEncoder().encode(CSV_TEXT),
};

const CSV_FORM_BODY = {
  parts: [{ name: "file", value: CSV_TEXT, filename: "rows.csv", contentType: "text/csv" }],
};

// The first server whose listing takes every filter the tests send, and the oldest supported one.
const SERVER_60 = createServerProfile({
  edition: "oss",
  version: { kind: "release", tag: "v0.60.4", major: 60, patch: 4 },
  date: null,
  hash: null,
  tokenFeatures: null,
});

const PROBE_URL = `https://mb.example.com/metabase${PROBE_PATH}`;

// What a medallion-era server answers a tier name with: its enum rejects the value.
// A medallion server checks an update's `data_layer` in the model rather than the request schema,
// so its 400 names no field.
function dataLayerUpdateRejected(value: string): Response {
  return jsonResponse(
    { message: `Invalid value ${value}. Must be one of gold, silver, bronze, copper`, value },
    400,
  );
}

function dataLayerFilterRejected(): Response {
  return jsonResponse({ errors: { "data-layer": "enum of gold, silver, bronze, copper" } }, 400);
}

const SERVER_58 = createServerProfile({
  edition: "oss",
  version: { kind: "release", tag: "v0.58.0", major: 58, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: null,
});

// The first server that keeps a table's user edits apart from the table, so a `null` withdraws one.
const SERVER_64 = createServerProfile({
  edition: "oss",
  version: { kind: "release", tag: "v0.64.1", major: 64, patch: 1 },
  date: null,
  hash: null,
  tokenFeatures: null,
});

const TABLE_URL = "https://mb.example.com/metabase/api/table/11";

const FOREIGN_KEY = {
  relationship: "Mt1",
  origin_id: 205,
  origin: {
    ...FIELD,
    id: 205,
    table_id: 12,
    name: "order_id",
    fk_target_field_id: 100,
    table: { ...TABLE, id: 12, name: "order_items", display_name: "Order Items" },
  },
  destination_id: 100,
  destination: { ...FIELD, id: 100, name: "id", table: TABLE },
};

function clientOver(responses: Array<Response>, server = SERVER_60) {
  const capture = captureFetch(responses);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
    server,
  });
  return { mb, capture };
}

describe("table resource wire requests", () => {
  it("sends the list request with no query parameters", async () => {
    const { mb, capture } = clientOver([jsonResponse([TABLE])]);

    await mb.table.list();

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/table",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends every list filter under the server's own kebab-case name, after probing for the access filters", async () => {
    const { mb, capture } = clientOver([probeResponse(SERVER_60), jsonResponse([TABLE])]);

    await mb.table.list({
      term: "ord",
      "visibility-type": "hidden",
      "data-layer": "final",
      "data-source": "upload",
      "owner-user-id": 7,
      "owner-email": "ada@example.com",
      "orphan-only": false,
      "can-query": true,
      "can-write": false,
      "include-transform-targets": true,
    });

    expect(capture.calls.map((call) => call.url)).toEqual([
      PROBE_URL,
      "https://mb.example.com/metabase/api/table?term=ord&visibility-type=hidden&data-layer=final&data-source=upload&owner-user-id=7&owner-email=ada%40example.com&orphan-only=false&can-query=true&can-write=false&include-transform-targets=true",
    ]);
  });

  it("refuses an access filter before the wire on a server whose listing drops it, as a fresh probe finds it", async () => {
    const { mb, capture } = clientOver([probeResponse(SERVER_58)]);

    const error = await thrownBy(() => mb.table.list({ term: "ord", "can-query": true }));

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.developerDetail).toEqual({
      reason: "version-too-old",
      detail:
        "This operation requires Metabase v59+ (this server is v0.58.0). Upgrade Metabase to use it.",
      feature: "tableListAccessFilters",
      since: 59,
      tokenFeature: null,
      serverVersion: "v0.58.0",
    });
    expect(capture.calls.map((call) => call.url)).toEqual([PROBE_URL]);
  });

  it("sends an access filter a cached profile from before an upgrade would have refused", async () => {
    const { mb, capture } = clientOver(
      [probeResponse(SERVER_60), jsonResponse([TABLE])],
      SERVER_58,
    );

    expect(await mb.table.list({ "can-query": true })).toEqual({ data: [TABLE], total: null });
    expect(capture.calls.map((call) => call.url)).toEqual([
      PROBE_URL,
      "https://mb.example.com/metabase/api/table?can-query=true",
    ]);
  });

  it("refuses the unused filter before the wire on a server without dependency tracking", async () => {
    const { mb, capture } = clientOver([probeResponse(SERVER_60)]);

    const error = await thrownBy(() => mb.table.list({ "unused-only": true }));

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.developerDetail).toEqual({
      reason: "missing-token-feature",
      detail:
        "This operation requires the 'dependencies' premium feature (not enabled on this server).",
      feature: "tableUnusedFilter",
      since: 58,
      tokenFeature: "dependencies",
      serverVersion: "v0.60.4",
    });
    expect(capture.calls.map((call) => call.url)).toEqual([PROBE_URL]);
  });

  it("lists with the filters the oldest supported server takes without asking it", async () => {
    const { mb, capture } = clientOver([jsonResponse([TABLE])], SERVER_58);

    await mb.table.list({ term: "ord", "orphan-only": true });

    expect(capture.calls.map((call) => call.url)).toEqual([
      "https://mb.example.com/metabase/api/table?term=ord&orphan-only=true",
    ]);
  });

  it("lists with every gated filter set to false without asking the oldest supported server", async () => {
    const { mb, capture } = clientOver([jsonResponse([TABLE])], SERVER_58);

    await mb.table.list({
      "can-query": false,
      "can-write": false,
      "include-transform-targets": false,
      "unused-only": false,
      "published-only": false,
    });

    expect(capture.calls.map((call) => call.url)).toEqual([
      "https://mb.example.com/metabase/api/table?unused-only=false&published-only=false&can-query=false&can-write=false&include-transform-targets=false",
    ]);
  });

  it("reports no total for the bare-array listing, which the server does not count", async () => {
    const { mb } = clientOver([jsonResponse([TABLE])]);

    expect(await mb.table.list()).toEqual({ data: [TABLE], total: null });
  });

  it("sends the fks request accepting any content type, since no fields answers none", async () => {
    const { mb, capture } = clientOver([jsonResponse([FOREIGN_KEY])]);

    await mb.table.fks(11);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/table/11/fks",
        method: "GET",
        headers: BINARY_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("reports the foreign keys as an uncounted list", async () => {
    const { mb } = clientOver([jsonResponse([FOREIGN_KEY])]);

    expect(await mb.table.fks(11)).toEqual({ data: [FOREIGN_KEY], total: null });
  });

  it("reads a no-content fks answer as an empty list", async () => {
    const { mb } = clientOver([new Response(null, { status: 204 })]);

    expect(await mb.table.fks(11)).toEqual({ data: [], total: null });
  });

  it("posts the sync-schema request with no body", async () => {
    const { mb, capture } = clientOver([jsonResponse({ status: "ok" })]);

    await mb.table.syncSchema(11);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/table/11/sync_schema",
        method: "POST",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("posts the rescan-values request with no body", async () => {
    const { mb, capture } = clientOver([jsonResponse({ status: "success" })]);

    await mb.table.rescanValues(11);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/table/11/rescan_values",
        method: "POST",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("posts the bulk edit with the selectors and the metadata in one body", async () => {
    const { mb, capture } = clientOver([jsonResponse({})]);

    await mb.table.bulkEdit({
      database_ids: [1],
      schema_ids: ["1:public"],
      table_ids: [11],
      data_layer: "final",
      owner_user_id: null,
    });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/data-studio/table/edit",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: '{"database_ids":[1],"schema_ids":["1:public"],"table_ids":[11],"data_layer":"final","owner_user_id":null}',
      },
    ]);
  });

  it("explains an unrouted bulk edit on a server below its floor", async () => {
    const { mb, capture } = clientOver(
      [routeMissingResponse(), probeResponse(SERVER_58)],
      SERVER_58,
    );

    const error = await thrownBy(() => mb.table.bulkEdit({ table_ids: [11], data_layer: "final" }));

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.developerDetail).toEqual({
      reason: "version-too-old",
      detail:
        "This operation requires Metabase v59+ (this server is v0.58.0). Upgrade Metabase to use it.",
      feature: "bulkTableEdit",
      since: 59,
      tokenFeature: null,
      serverVersion: "v0.58.0",
    });
    expect(capture.calls.map((call) => call.url)).toEqual([
      "https://mb.example.com/metabase/api/data-studio/table/edit",
      PROBE_URL,
    ]);
  });

  it("sends the get request", async () => {
    const { mb, capture } = clientOver([jsonResponse(TABLE)]);

    await mb.table.get(11);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/table/11",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the update request as a PUT carrying only the patched fields", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...TABLE, display_name: "Customers" })]);

    await mb.table.update(11, { display_name: "Customers" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/table/11",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: '{"display_name":"Customers"}',
      },
    ]);
  });

  it("explains a rejected tier name for data_layer on a server that speaks medallions", async () => {
    const { mb, capture } = clientOver(
      [dataLayerUpdateRejected("final"), probeResponse(SERVER_58)],
      SERVER_58,
    );

    const error = await thrownBy(() => mb.table.update(11, { data_layer: "final" }));

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.developerDetail).toEqual({
      reason: "version-too-old",
      detail:
        "This operation requires Metabase v59+ (this server is v0.58.0). Upgrade Metabase to use it.",
      feature: "tableDataLayerTiers",
      since: 59,
      tokenFeature: null,
      serverVersion: "v0.58.0",
    });
    expect(capture.calls.map((call) => call.url)).toEqual([
      "https://mb.example.com/metabase/api/table/11",
      PROBE_URL,
    ]);
  });

  it("sends a medallion name for data_layer to the server a fresh probe finds speaking it", async () => {
    const { mb, capture } = clientOver([probeResponse(SERVER_58), jsonResponse(TABLE)], SERVER_58);

    await mb.table.update(11, { data_layer: "gold" });

    expect(capture.calls.map((call) => call.body)).toEqual([null, '{"data_layer":"gold"}']);
  });

  it("refuses a medallion name for data_layer before the wire on a server that speaks tiers", async () => {
    const { mb, capture } = clientOver([probeResponse(SERVER_60)]);

    const error = await thrownBy(() => mb.table.update(11, { data_layer: "gold" }));

    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toBe(
      'data_layer "gold" is a medallion name; this server names a table\'s layer final, internal, hidden',
    );
    expect(capture.calls.map((call) => call.url)).toEqual([PROBE_URL]);
  });

  it("refuses a data_authority withdrawal on update before the wire on a server that keeps it on the table, as a fresh probe finds it", async () => {
    const { mb, capture } = clientOver([probeResponse(SERVER_60)], SERVER_64);

    const error = await thrownBy(() => mb.table.update(11, { data_authority: null }));

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.developerDetail).toEqual({
      reason: "version-too-old",
      detail:
        "This operation requires Metabase v64+ (this server is v0.60.4). Upgrade Metabase to use it.",
      feature: "tableUserValueWithdrawal",
      since: 64,
      tokenFeature: null,
      serverVersion: "v0.60.4",
    });
    expect(capture.calls.map((call) => call.url)).toEqual([PROBE_URL]);
  });

  it("sends a data_authority withdrawal on update to the server a fresh probe finds keeping user edits apart", async () => {
    const { mb, capture } = clientOver([probeResponse(SERVER_64), jsonResponse(TABLE)]);

    await mb.table.update(11, { data_authority: null });

    expect(
      capture.calls.map((call) => ({ url: call.url, method: call.method, body: call.body })),
    ).toEqual([
      { url: PROBE_URL, method: "GET", body: null },
      { url: TABLE_URL, method: "PUT", body: '{"data_authority":null}' },
    ]);
  });

  it("fails an update the server answers with the table outside the collection asked for", async () => {
    const { mb, capture } = clientOver([jsonResponse(TABLE)], SERVER_64);

    const error = await thrownBy(() => mb.table.update(11, { collection_id: 7 }));

    assert(error instanceof PartialWriteError, "expected PartialWriteError");
    expect(error.message).toBe(
      "the server applied the rest of the update to table 11 but not collection_id: the table stays in no collection, because this server does not move a table to a collection through an update",
    );
    expect(capture.calls.map((call) => call.url)).toEqual([TABLE_URL]);
  });

  it("sends a collection on update without consulting the server first", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...TABLE, collection_id: 7 })]);

    await mb.table.update(11, { collection_id: 7 });

    expect(
      capture.calls.map((call) => ({ url: call.url, method: call.method, body: call.body })),
    ).toEqual([{ url: TABLE_URL, method: "PUT", body: '{"collection_id":7}' }]);
  });

  it("explains a rejected tier name in the data-layer filter on a server that speaks medallions", async () => {
    const { mb, capture } = clientOver(
      [dataLayerFilterRejected(), probeResponse(SERVER_58)],
      SERVER_58,
    );

    const error = await thrownBy(() => mb.table.list({ "data-layer": "hidden" }));

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.developerDetail.feature).toBe("tableDataLayerTiers");
    expect(capture.calls.map((call) => call.url)).toEqual([
      "https://mb.example.com/metabase/api/table?data-layer=hidden",
      PROBE_URL,
    ]);
  });

  it("sends the query-metadata request", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...TABLE, fields: [FIELD] })]);

    await mb.table.queryMetadata(11);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/table/11/query_metadata",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("posts the append-csv request with the file as multipart form data", async () => {
    const { mb, capture } = clientOver([new Response(null, { status: 200 })]);

    await mb.table.appendCsv(11, CSV_FILE);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/table/11/append-csv",
        method: "POST",
        headers: BINARY_READ_HEADERS,
        body: CSV_FORM_BODY,
      },
    ]);
  });

  it("posts the replace-csv request with the file as multipart form data", async () => {
    const { mb, capture } = clientOver([new Response(null, { status: 200 })]);

    await mb.table.replaceCsv(11, CSV_FILE);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/table/11/replace-csv",
        method: "POST",
        headers: BINARY_READ_HEADERS,
        body: CSV_FORM_BODY,
      },
    ]);
  });

  it("confirms an append against the table it was asked for", async () => {
    const { mb } = clientOver([new Response(null, { status: 200 })]);

    expect(await mb.table.appendCsv(11, CSV_FILE)).toEqual({ table_id: 11, action: "append" });
  });

  it("confirms a replace against the table it was asked for", async () => {
    const { mb } = clientOver([new Response(null, { status: 200 })]);

    expect(await mb.table.replaceCsv(11, CSV_FILE)).toEqual({ table_id: 11, action: "replace" });
  });
});
