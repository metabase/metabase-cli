// Test-only fetch double (the keyring-mock pattern): scripted responses plus a capture of every
// call, shared by the client/oauth/logout suites so each doesn't grow its own drifting stub.

// A caller identity no production code could produce, so a hardcoded fallback cannot fake it.
export const TEST_USER_AGENT = "some-embedder/9.9.9";

// One `FormData` entry, read back as data. `filename`/`contentType` are null for a plain text
// field and carry the file's own values for a file part, so a multipart body deep-equals against a
// literal instead of against a boundary string the runtime picks.
export interface CapturedFormPart {
  name: string;
  value: string;
  filename: string | null;
  contentType: string | null;
}

export interface CapturedFormBody {
  parts: CapturedFormPart[];
}

export type CapturedBody = string | CapturedFormBody | null;

export interface CapturedFetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: CapturedBody;
}

type ResponseFactory = () => Response | Promise<Response>;
export type FetchScript = ReadonlyArray<Response | ResponseFactory | Error>;

export interface FetchCapture {
  fetch: typeof fetch;
  calls: CapturedFetchCall[];
}

export function captureFetch(script: FetchScript): FetchCapture {
  const queue = [...script];
  const calls: CapturedFetchCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({
      url: typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
      method: init?.method ?? "GET",
      headers: headersToRecord(init?.headers),
      body: await capturedBody(init?.body),
    });
    const next = queue.shift();
    if (next === undefined) {
      throw new Error("captureFetch: no more responses queued");
    }
    if (next instanceof Error) {
      throw next;
    }
    return typeof next === "function" ? await next() : next;
  };
  return { fetch: fetchImpl, calls };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function capturedBody(body: RequestInit["body"]): Promise<CapturedBody> {
  if (body === undefined || body === null) {
    return null;
  }
  if (typeof body === "string") {
    return body;
  }
  if (body instanceof URLSearchParams) {
    return body.toString();
  }
  if (body instanceof FormData) {
    return { parts: await formParts(body) };
  }
  throw new Error("captureFetch: unsupported request body type");
}

async function formParts(form: FormData): Promise<CapturedFormPart[]> {
  const parts: CapturedFormPart[] = [];
  for (const [name, value] of form) {
    if (typeof value === "string") {
      parts.push({ name, value, filename: null, contentType: null });
      continue;
    }
    parts.push({
      name,
      value: await value.text(),
      filename: value.name,
      contentType: value.type,
    });
  }
  return parts;
}

function headersToRecord(init: RequestInit["headers"]): Record<string, string> {
  const result: Record<string, string> = {};
  if (!init) {
    return result;
  }
  if (init instanceof Headers) {
    for (const [key, value] of init.entries()) {
      result[key] = value;
    }
    return result;
  }
  if (Array.isArray(init)) {
    for (const entry of init) {
      const key = entry[0];
      const value = entry[1];
      if (typeof key === "string" && typeof value === "string") {
        result[key] = value;
      }
    }
    return result;
  }
  for (const [key, value] of Object.entries(init)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  return result;
}
