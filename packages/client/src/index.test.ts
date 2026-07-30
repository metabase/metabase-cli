import { assert, describe, expect, it } from "vitest";
import { z } from "zod";

import { captureFetch, jsonResponse, TEST_USER_AGENT } from "./testing/fetch-capture";
import * as barrel from "./index";
import {
  createClient,
  isHttpNotFound,
  CardCreateInput,
  CardUpdateInput,
  CollectionCreateInput,
  CollectionUpdateInput,
  DashboardCreateInput,
  DashboardUpdateInput,
  DashcardPatchInput,
  DocumentCreateInput,
  DocumentUpdateInput,
  EidTranslateInput,
  FieldUpdateInput,
  HttpError,
  MeasureCreateInput,
  MeasureUpdateInput,
  NotificationCreateInput,
  NotificationUpdateInput,
  PulseCreateInput,
  PulseUpdateInput,
  ResponseShapeError,
  SegmentCreateInput,
  SegmentUpdateInput,
  SetupInput,
  SnippetCreateInput,
  SnippetUpdateInput,
  TableUpdateInput,
  TimelineCreateInput,
  TimelineEventCreateInput,
  TimelineEventUpdateInput,
  TimelineUpdateInput,
  TimeoutError,
  TipTapNodeInput,
  TransformCreateInput,
  TransformJobCreateInput,
  TransformJobUpdateInput,
  TransformTagCreateInput,
  TransformTagUpdateInput,
  TransformUpdateInput,
} from "./index";
import type {
  ClientCredentials,
  CredentialRefresher,
  DecodedResponseShapeDetail,
  HttpErrorDetail,
  ListResult,
  MetabaseClient,
  RequestOptions,
  HttpErrorKind,
  HttpTimeoutDetail,
  NetworkErrorDetail,
  PollingTimeoutDetail,
  ResponseShapeErrorDetail,
  ServerTagResolver,
  TimeoutErrorDetail,
  UnknownErrorDetail,
  ValidationErrorDetail,
  ZodResponseShapeDetail,
} from "./index";

// A Zod schema and the type alias merged onto its name are one `export { X }` binding, but only
// naming both proves it: the explicit type argument fails to compile if the alias is missing, the
// call argument fails if the value is, and the two must agree on what the schema infers.
function pin<T>(schema: z.ZodType<T>): z.ZodType<T> {
  return schema;
}

const writePath = {
  CardCreateInput: pin<CardCreateInput>(CardCreateInput),
  CardUpdateInput: pin<CardUpdateInput>(CardUpdateInput),
  CollectionCreateInput: pin<CollectionCreateInput>(CollectionCreateInput),
  CollectionUpdateInput: pin<CollectionUpdateInput>(CollectionUpdateInput),
  DashboardCreateInput: pin<DashboardCreateInput>(DashboardCreateInput),
  DashboardUpdateInput: pin<DashboardUpdateInput>(DashboardUpdateInput),
  DashcardPatchInput: pin<DashcardPatchInput>(DashcardPatchInput),
  DocumentCreateInput: pin<DocumentCreateInput>(DocumentCreateInput),
  DocumentUpdateInput: pin<DocumentUpdateInput>(DocumentUpdateInput),
  EidTranslateInput: pin<EidTranslateInput>(EidTranslateInput),
  FieldUpdateInput: pin<FieldUpdateInput>(FieldUpdateInput),
  MeasureCreateInput: pin<MeasureCreateInput>(MeasureCreateInput),
  MeasureUpdateInput: pin<MeasureUpdateInput>(MeasureUpdateInput),
  NotificationCreateInput: pin<NotificationCreateInput>(NotificationCreateInput),
  NotificationUpdateInput: pin<NotificationUpdateInput>(NotificationUpdateInput),
  PulseCreateInput: pin<PulseCreateInput>(PulseCreateInput),
  PulseUpdateInput: pin<PulseUpdateInput>(PulseUpdateInput),
  SegmentCreateInput: pin<SegmentCreateInput>(SegmentCreateInput),
  SegmentUpdateInput: pin<SegmentUpdateInput>(SegmentUpdateInput),
  SetupInput: pin<SetupInput>(SetupInput),
  SnippetCreateInput: pin<SnippetCreateInput>(SnippetCreateInput),
  SnippetUpdateInput: pin<SnippetUpdateInput>(SnippetUpdateInput),
  TableUpdateInput: pin<TableUpdateInput>(TableUpdateInput),
  TimelineCreateInput: pin<TimelineCreateInput>(TimelineCreateInput),
  TimelineEventCreateInput: pin<TimelineEventCreateInput>(TimelineEventCreateInput),
  TimelineEventUpdateInput: pin<TimelineEventUpdateInput>(TimelineEventUpdateInput),
  TimelineUpdateInput: pin<TimelineUpdateInput>(TimelineUpdateInput),
  TipTapNodeInput: pin<TipTapNodeInput>(TipTapNodeInput),
  TransformCreateInput: pin<TransformCreateInput>(TransformCreateInput),
  TransformJobCreateInput: pin<TransformJobCreateInput>(TransformJobCreateInput),
  TransformJobUpdateInput: pin<TransformJobUpdateInput>(TransformJobUpdateInput),
  TransformTagCreateInput: pin<TransformTagCreateInput>(TransformTagCreateInput),
  TransformTagUpdateInput: pin<TransformTagUpdateInput>(TransformTagUpdateInput),
  TransformUpdateInput: pin<TransformUpdateInput>(TransformUpdateInput),
};

const INPUT_SUFFIX = "Input";

// `developerDetail` is `unknown` on the abstract base, so a consumer that narrows to a concrete
// error class has to be able to name the shape it gets back.
type DeveloperDetail =
  | HttpErrorDetail
  | NetworkErrorDetail
  | ResponseShapeErrorDetail
  | TimeoutErrorDetail
  | UnknownErrorDetail
  | ValidationErrorDetail;

function developerDetailOf(error: HttpError): DeveloperDetail {
  return error.developerDetail;
}

// One step further in than `developerDetailOf`: a `TimeoutError` carries a two-armed detail, and a
// consumer that switches on the discriminant needs a name for the arm it lands on. These would not
// compile without the narrow, and the arm has no name off the barrel without the export.
function httpTimeoutDetailOf(error: TimeoutError): HttpTimeoutDetail | null {
  return error.developerDetail.kind === "http" ? error.developerDetail : null;
}

function pollingTimeoutDetailOf(error: TimeoutError): PollingTimeoutDetail | null {
  return error.developerDetail.kind === "polling" ? error.developerDetail : null;
}

function zodResponseShapeDetailOf(error: ResponseShapeError): ZodResponseShapeDetail | null {
  return error.developerDetail.kind === "zod" ? error.developerDetail : null;
}

function decodedResponseShapeDetailOf(
  error: ResponseShapeError,
): DecodedResponseShapeDetail | null {
  return error.developerDetail.kind === "decoded" ? error.developerDetail : null;
}

function describeKind(kind: HttpErrorKind): string {
  switch (kind) {
    case "route-missing": {
      return "the route is not served by this Metabase";
    }
    case "resource-missing": {
      return "the route exists and the resource does not";
    }
    case "auth": {
      return "the credential was rejected";
    }
    case "rate-limit": {
      return "the caller is sending too fast";
    }
    case "server-error": {
      return "Metabase failed to answer";
    }
    case "generic": {
      return "an unclassified failure";
    }
  }
}

interface ClientHooks {
  refreshCredential: CredentialRefresher;
  getServerTag: ServerTagResolver;
}

function hooksOf(options: barrel.ClientOptions): ClientHooks | null {
  const { refreshCredential, getServerTag } = options;
  if (refreshCredential === undefined || getServerTag === undefined) {
    return null;
  }
  return { refreshCredential, getServerTag };
}

const ROUTE_MISSING_BODY = JSON.stringify({ message: "API endpoint does not exist." });

const refreshCredential: CredentialRefresher = () => Promise.resolve(null);
const getServerTag: ServerTagResolver = () => Promise.resolve("v0.58.0");

const CONSUMER_CREDENTIALS: ClientCredentials = {
  url: "https://m.example.com",
  credential: { kind: "apiKey", apiKey: "mb_consumer_key" },
};

const CardRow = z.object({ id: z.number().int() });
type CardRow = z.infer<typeof CardRow>;

// A resource method as a consumer would write one, named end to end from the barrel: the client,
// the caller-facing options, the uniform list result, and the guard that reads a missing route as
// nothing to list.
async function listCardRows(
  mb: MetabaseClient,
  options: RequestOptions,
): Promise<ListResult<CardRow>> {
  try {
    const data = await mb.requestParsed(z.array(CardRow), "/api/card", options);
    return { data, total: data.length };
  } catch (error) {
    if (isHttpNotFound(error)) {
      return { data: [], total: null };
    }
    throw error;
  }
}

describe("@metabase/client barrel as a consumer surface", () => {
  it("names every input schema the barrel exports in a value-and-type position", () => {
    const onBarrel = Object.keys(barrel)
      .filter((name) => name.endsWith(INPUT_SUFFIX))
      .toSorted();
    expect(Object.keys(writePath).toSorted()).toEqual(onBarrel);
  });

  it("classifies a 404 through a switch that covers HttpErrorKind exhaustively", () => {
    const error = new HttpError({
      status: 404,
      statusText: "Not Found",
      method: "GET",
      url: "https://metabase.example.com/api/nope",
      responseHeaders: { "content-type": "application/json" },
      rawBody: ROUTE_MISSING_BODY,
    });
    expect(describeKind(error.kind)).toBe("the route is not served by this Metabase");
  });

  it("hands a narrowed error's developerDetail back under a nameable type", () => {
    const error = new HttpError({
      status: 401,
      statusText: "Unauthorized",
      method: "GET",
      url: "https://metabase.example.com/api/user/current",
      responseHeaders: { "content-type": "application/json" },
      rawBody: null,
    });
    expect(developerDetailOf(error)).toEqual({
      status: 401,
      statusText: "Unauthorized",
      method: "GET",
      url: "https://metabase.example.com/api/user/current",
      responseHeaders: { "content-type": "application/json" },
      body: null,
      fieldErrors: null,
      specificFieldErrors: null,
    });
  });

  it("names the arm a caller narrows a request timeout to", () => {
    const error = new TimeoutError("Request timed out after 25ms", {
      kind: "http",
      method: "GET",
      url: "https://metabase.example.com/api/user/current",
      timeoutMs: 25,
    });
    expect(httpTimeoutDetailOf(error)).toEqual({
      kind: "http",
      method: "GET",
      url: "https://metabase.example.com/api/user/current",
      timeoutMs: 25,
    });
  });

  it("names the arm a caller narrows a polling timeout to", () => {
    const error = new TimeoutError("Polling timed out after 600000ms", {
      kind: "polling",
      timeoutMs: 600_000,
      attempts: 3,
    });
    expect(pollingTimeoutDetailOf(error)).toEqual({
      kind: "polling",
      timeoutMs: 600_000,
      attempts: 3,
    });
  });

  it("names the arm a caller narrows a failed schema parse to", () => {
    const schema = z.object({ id: z.number() });
    const parsed = schema.safeParse({ id: "x" });
    assert(!parsed.success, "expected zod failure");
    const error = ResponseShapeError.fromZodIssues({
      kind: "zod",
      method: "GET",
      url: "https://metabase.example.com/api/card/1",
      status: 200,
      zodIssues: parsed.error.issues,
      serverTag: null,
    });
    expect(zodResponseShapeDetailOf(error)).toEqual({
      kind: "zod",
      method: "GET",
      url: "https://metabase.example.com/api/card/1",
      status: 200,
      zodIssues: parsed.error.issues,
      serverTag: null,
    });
  });

  it("names the arm a caller narrows a hand-decoded payload to", () => {
    const error = new ResponseShapeError("upload succeeded but the response body was empty", {
      kind: "decoded",
      source: "response body",
      value: "",
    });
    expect(decodedResponseShapeDetailOf(error)).toEqual({
      kind: "decoded",
      source: "response body",
      value: "",
    });
  });

  it("reads the other arm's narrow as no match rather than as a detail", () => {
    const error = new TimeoutError("Polling timed out after 600000ms", {
      kind: "polling",
      timeoutMs: 600_000,
      attempts: 3,
    });
    expect(httpTimeoutDetailOf(error)).toBeNull();
  });

  it("builds a working client from createClient and returns its rows as a ListResult", async () => {
    const fakeFetch = captureFetch([jsonResponse([{ id: 4 }, { id: 9 }])]);
    const mb = createClient(CONSUMER_CREDENTIALS, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: fakeFetch.fetch,
    });

    expect(await listCardRows(mb, { timeoutMs: 5_000 })).toEqual({
      data: [{ id: 4 }, { id: 9 }],
      total: 2,
    });
  });

  it("reads a 404 from that client through isHttpNotFound rather than as a failure", async () => {
    const fakeFetch = captureFetch([
      new Response('{"message":"Not found."}', {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    ]);
    const mb = createClient(CONSUMER_CREDENTIALS, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: fakeFetch.fetch,
    });

    expect(await listCardRows(mb, {})).toEqual({ data: [], total: null });
  });

  it("lets a caller name the transport hooks it passes to createTransport", () => {
    expect(hooksOf({ userAgent: "consumer/1.0", refreshCredential, getServerTag })).toEqual({
      refreshCredential,
      getServerTag,
    });
  });
});
