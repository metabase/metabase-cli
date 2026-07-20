// Test-only fetch double (the keyring-mock pattern): scripted responses plus a capture of every
// call, shared by the client/oauth/logout suites so each doesn't grow its own drifting stub.

export interface CapturedFetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
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
      body: bodyText(init?.body),
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

function bodyText(body: RequestInit["body"]): string | null {
  if (body === undefined || body === null) {
    return null;
  }
  if (typeof body === "string") {
    return body;
  }
  if (body instanceof URLSearchParams) {
    return body.toString();
  }
  throw new Error("captureFetch: unsupported request body type");
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
