import { assert, describe, expect, it } from "vitest";
import type { ZodError } from "zod";
import { z } from "zod";

import { ResponseShapeError } from "../errors";
import { type PaginatedEnvelope, paginatePages } from "../paginate";

import { type ClientCredentials, createTransport } from "../http/transport";
import { createFakeClient, type FakeClientCall } from "./fake-client";
import { captureFetch, jsonResponse, TEST_USER_AGENT } from "./fetch-capture";

const CONFIG: ClientCredentials = {
  url: "https://m.example.com",
  credential: { kind: "apiKey", apiKey: "mb_test_key_abcdef0123" },
};

const PATH = "/api/user/current";
const PingResponse = z.object({ id: z.number().int(), email: z.string() });

const Row = z.object({ id: z.number().int(), name: z.string() });
type Row = z.infer<typeof Row>;

const ROWS: ReadonlyArray<Row> = [
  { id: 1, name: "one" },
  { id: 2, name: "two" },
  { id: 3, name: "three" },
  { id: 4, name: "four" },
  { id: 5, name: "five" },
];

interface ShapeFailure {
  name: string;
  category: string;
  userMessage: string;
  method: string;
  url: string;
  status: number;
  zodIssues: ZodError["issues"];
  serverTag: string | null;
}

function shapeFailure(error: unknown): ShapeFailure {
  assert(error instanceof ResponseShapeError, "expected ResponseShapeError");
  const detail = error.developerDetail;
  assert(detail.kind === "zod", "expected a schema-parse detail");
  return {
    name: error.name,
    category: error.category,
    userMessage: error.userMessage,
    method: detail.method,
    url: detail.url,
    status: detail.status,
    zodIssues: detail.zodIssues,
    serverTag: detail.serverTag,
  };
}

function numericQuery(call: FakeClientCall, key: string): number {
  const value = call.options?.query?.[key];
  assert(typeof value === "number", `expected a numeric ${key} in the query`);
  return value;
}

function rowPage(call: FakeClientCall): PaginatedEnvelope<Row> {
  const offset = numericQuery(call, "offset");
  const limit = numericQuery(call, "limit");
  return { data: ROWS.slice(offset, offset + limit), total: ROWS.length };
}

describe("createFakeClient", () => {
  it("rejects a body the schema refuses with the error the real client would raise", async () => {
    const body = { id: "not-a-number", email: "a@b.com" };
    const real = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: captureFetch([jsonResponse(body)]).fetch,
    });
    const { client: fake } = createFakeClient({
      routes: [{ path: PATH, reply: { kind: "body", body } }],
    });

    const realError = await real
      .requestParsed(PingResponse, PATH)
      .catch((caught: unknown) => caught);
    const fakeError = await fake
      .requestParsed(PingResponse, PATH)
      .catch((caught: unknown) => caught);

    expect(shapeFailure(fakeError)).toEqual({ ...shapeFailure(realError), url: PATH });
  });

  it("serves a different body per method on one path", async () => {
    const { client } = createFakeClient({
      routes: [
        { path: PATH, reply: { kind: "body", body: { id: 1, email: "read@b.com" } } },
        {
          method: "POST",
          path: PATH,
          reply: { kind: "body", body: { id: 2, email: "written@b.com" } },
        },
      ],
    });

    expect(await client.requestParsed(PingResponse, PATH)).toEqual({ id: 1, email: "read@b.com" });
    expect(await client.requestParsed(PingResponse, PATH, { method: "POST" })).toEqual({
      id: 2,
      email: "written@b.com",
    });
  });

  it("throws naming the method and path when no route matches", async () => {
    const { client } = createFakeClient({
      routes: [{ path: PATH, reply: { kind: "body", body: { id: 1, email: "read@b.com" } } }],
    });

    await expect(client.requestParsed(PingResponse, PATH, { method: "DELETE" })).rejects.toThrow(
      `unexpected request: DELETE ${PATH}`,
    );
  });

  it("walks a paginated endpoint page by page when the reply is a function of the request", async () => {
    const { client } = createFakeClient({
      routes: [{ path: "/api/row", reply: { kind: "respond", respond: rowPage } }],
    });

    const pages: Row[][] = [];
    for await (const page of paginatePages(client, "/api/row", Row, { pageSize: 2 })) {
      pages.push(page.items);
    }

    expect(pages).toEqual([[ROWS[0], ROWS[1]], [ROWS[2], ROWS[3]], [ROWS[4]]]);
  });
});
