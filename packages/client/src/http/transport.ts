import type { ZodType } from "zod";

import { errorMessage, NetworkError, TimeoutError } from "../errors";
import { JSON_CONTENT_TYPE } from "../json";
import { combineAborts, throwIfAborted } from "../signal";
import { normalizeUrl } from "../url";

import {
  assertCredentialHeaderSafe,
  type Credential,
  credentialAuthHeader,
  credentialSecrets,
  type CredentialRefresher,
} from "../auth/credential";

import { HttpError, isRetryableStatus } from "./errors";
import { buildNetworkError, isConnectionClosed } from "./network-error";
import { NO_SERVER_TAG, parseJsonResponse } from "./response-shape";
import { backoffDelay, DEFAULT_MAX_RETRIES, runWithRetries, type RetryOutcome } from "./retry";
import type { RedactionContext } from "./sanitize";

const UNAUTHORIZED_STATUS = 401;

export type HttpMethod = "GET" | "HEAD" | "OPTIONS" | "POST" | "PUT" | "PATCH" | "DELETE";
export type ExpectedContentType = "json" | "text" | "binary";

export const DEFAULT_METHOD: HttpMethod = "GET";

const DEFAULT_TIMEOUT_MS = 30_000;
const OCTET_STREAM_CONTENT_TYPE = "application/octet-stream";
const TEXT_CONTENT_TYPE_PREFIX = "text/";
const ERROR_BODY_BYTE_CAP = 64 * 1024;

const IDEMPOTENT_METHODS: ReadonlySet<HttpMethod> = new Set(["GET", "HEAD", "OPTIONS"]);

export type QueryPrimitive = string | number | boolean;
export type QueryValue = QueryPrimitive | ReadonlyArray<QueryPrimitive> | undefined;

// What a caller may hand to a resource method. The wire shape — method, path, query, body, expected
// content type — is the resource method's own to decide, so none of it is reachable from here.
// `idempotent` is: only the caller knows whether the endpoint behind a write tolerates a resend.
export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
  idempotent?: boolean;
}

export interface TransportRequestOptions extends RequestOptions {
  method?: HttpMethod;
  query?: Record<string, QueryValue>;
  body?: unknown;
  expectContentType?: ExpectedContentType;
}

export interface Transport {
  requestParsed<T>(schema: ZodType<T>, path: string, opts?: TransportRequestOptions): Promise<T>;
  requestRaw(path: string, opts?: TransportRequestOptions): Promise<Response>;
  requestStream(path: string, opts?: TransportRequestOptions): Promise<ReadableStream<Uint8Array>>;
}

export interface ClientCredentials {
  url: string;
  credential: Credential;
}

type FetchBody = NonNullable<RequestInit["body"]>;

interface PreparedRequest {
  url: string;
  method: HttpMethod;
  headers: Headers;
  body: FetchBody | null;
  expectContentType: ExpectedContentType;
  retries: number;
  idempotent: boolean;
  timeoutMs: number;
  cancelSignal: AbortSignal;
}

interface ExecOutcome {
  response: Response;
  prepared: PreparedRequest;
}

export type ServerTagResolver = () => Promise<string | null>;

// Required so no caller can reach a Metabase anonymously: the wire identity is the caller's to
// declare, not something this layer invents on their behalf.
export interface ClientOptions {
  userAgent: string;
  fetchImpl?: typeof fetch;
  getServerTag?: ServerTagResolver;
  refreshCredential?: CredentialRefresher;
  // Cancels every request this client makes; composed with the per-request `signal` and the
  // timeout. A process-level interrupt is the caller's to own and to hand over here.
  signal?: AbortSignal;
}

export function createTransport(config: ClientCredentials, options: ClientOptions): Transport {
  const baseUrl = normalizeUrl(config.url);
  assertCredentialHeaderSafe(config.credential);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const getServerTag = options.getServerTag ?? NO_SERVER_TAG;
  const refreshCredential = options.refreshCredential;
  let credential = config.credential;
  const knownSecrets = new Set(credentialSecrets(credential));
  const redactionContext: RedactionContext = { knownSecrets };

  // Single-flight: concurrent 401s (e.g. verify's parallel user+probe requests) must share one
  // refresh. The server rotates refresh tokens, so a second concurrent refresh would replay the
  // already-consumed token — which rotation reuse detection may answer by revoking the whole grant.
  let refreshInFlight: Promise<boolean> | null = null;

  function tryRefreshCredential(): Promise<boolean> {
    const refresh = refreshCredential;
    if (credential.kind !== "oauth" || refresh === undefined) {
      return Promise.resolve(false);
    }
    refreshInFlight ??= refreshOnce(refresh).finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  }

  async function refreshOnce(refresh: CredentialRefresher): Promise<boolean> {
    const next = await refresh();
    if (next === null) {
      return false;
    }
    credential = next;
    for (const secret of credentialSecrets(next)) {
      knownSecrets.add(secret);
    }
    return true;
  }

  async function attemptOnce(prepared: PreparedRequest, attempt: number): Promise<RetryOutcome> {
    const hasRetriesLeft = attempt < prepared.retries;
    const timeoutSignal = AbortSignal.timeout(prepared.timeoutMs);
    const combined = combineAborts(timeoutSignal, prepared.cancelSignal);

    let response: Response;
    try {
      response = await fetchImpl(prepared.url, {
        method: prepared.method,
        headers: prepared.headers,
        body: prepared.body,
        signal: combined,
      });
    } catch (error) {
      throwIfAborted(prepared.cancelSignal);
      // A dropped connection or an elapsed timeout says nothing about whether the request landed:
      // the bytes may never have left the client, or the server may already have committed the
      // write and lost only the response. Metabase offers no idempotency-key framework to tell a
      // replay from a first delivery, so a resend is only safe for a method safe to repeat — the
      // same question, and the same answer, as the status gate below. A caller who knows the
      // endpoint tolerates a resend opts back in with `idempotent: true`.
      //
      // A pooled connection reaped by the peer between requests is the one failure that reports the
      // socket's age rather than the server's health, so it earns an attempt on a fresh socket even
      // when the caller opted out of retries entirely.
      const isStaleSocketFirstTry = attempt === 0 && isConnectionClosed(error);
      if (prepared.idempotent && (hasRetriesLeft || isStaleSocketFirstTry)) {
        return { kind: "retry", delayMs: backoffDelay({ attempt }) };
      }
      if (timeoutSignal.aborted) {
        throw new TimeoutError(`Request timed out after ${prepared.timeoutMs}ms`, {
          kind: "http",
          method: prepared.method,
          url: prepared.url,
          timeoutMs: prepared.timeoutMs,
        });
      }
      throw buildNetworkError(error, prepared.method, prepared.url);
    }

    // Metabase offers no idempotency-key framework, so the server cannot recognise a replayed
    // write as the same request: retrying a POST whose response was lost double-creates. A status
    // code is only grounds for another attempt when the method is safe to repeat.
    const canRetryStatus = hasRetriesLeft && prepared.idempotent;
    if (!response.ok && isRetryableStatus(response.status) && canRetryStatus) {
      const retryAfter = response.headers.get("Retry-After");
      void response.body?.cancel().catch(() => undefined);
      return {
        kind: "retry",
        delayMs: backoffDelay({ attempt, retryAfterHeader: retryAfter }),
      };
    }

    if (!response.ok) {
      const rawBody = await readBodyForError(response);
      const serverTag = await getServerTag();
      throw new HttpError({
        status: response.status,
        statusText: response.statusText,
        method: prepared.method,
        url: prepared.url,
        responseHeaders: response.headers,
        rawBody,
        serverTag,
        redactionContext,
      });
    }

    assertContentType(response, prepared);
    return { kind: "success", response };
  }

  async function executeRaw(prepared: PreparedRequest): Promise<Response> {
    try {
      return await runWithRetries(
        (attempt) => attemptOnce(prepared, attempt),
        prepared.cancelSignal,
      );
    } catch (error) {
      // A cancellation during the backoff sleep surfaces as the timer's own rejection, which
      // carries none of the taxonomy; the signal's reason does.
      throwIfAborted(prepared.cancelSignal);
      throw error;
    }
  }

  // On a 401 with an OAuth credential, attempt a single token refresh and replay the request with
  // the new access token. API-key credentials and non-401 errors propagate unchanged.
  async function executeWithAuthRefresh(
    path: string,
    opts: TransportRequestOptions,
  ): Promise<ExecOutcome> {
    const prepared = prepare(path, opts);
    try {
      return { response: await executeRaw(prepared), prepared };
    } catch (error) {
      if (error instanceof HttpError && error.status === UNAUTHORIZED_STATUS) {
        if (await tryRefreshCredential()) {
          const retried = prepare(path, opts);
          return { response: await executeRaw(retried), prepared: retried };
        }
      }
      throw error;
    }
  }

  function prepare(path: string, opts: TransportRequestOptions = {}): PreparedRequest {
    const method = opts.method ?? DEFAULT_METHOD;
    const expectContentType = opts.expectContentType ?? "json";
    const url = buildUrl(baseUrl, path, opts.query);
    const headers = new Headers();
    const auth = credentialAuthHeader(credential);
    headers.set(auth.name, auth.value);
    headers.set("accept", acceptHeader(expectContentType));
    headers.set("user-agent", options.userAgent);
    let body: FetchBody | null = null;
    if (opts.body !== undefined && opts.body !== null) {
      if (typeof opts.body === "string" || opts.body instanceof URLSearchParams) {
        body = opts.body;
      } else if (opts.body instanceof FormData || opts.body instanceof ReadableStream) {
        body = opts.body;
      } else if (opts.body instanceof Uint8Array) {
        body = opts.body;
        headers.set("content-type", OCTET_STREAM_CONTENT_TYPE);
      } else {
        body = JSON.stringify(opts.body);
        headers.set("content-type", JSON_CONTENT_TYPE);
      }
    }
    return {
      url,
      method,
      headers,
      body,
      expectContentType,
      retries: opts.retries ?? DEFAULT_MAX_RETRIES,
      idempotent: opts.idempotent ?? IDEMPOTENT_METHODS.has(method),
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      cancelSignal: combineAborts(opts.signal, options.signal),
    };
  }

  return {
    async requestRaw(path, opts) {
      return (await executeWithAuthRefresh(path, opts ?? {})).response;
    },
    async requestParsed(schema, path, opts) {
      const { response, prepared } = await executeWithAuthRefresh(path, {
        ...opts,
        expectContentType: "json",
      });
      const text = await response.text();
      return parseJsonResponse(text, schema, {
        method: prepared.method,
        url: prepared.url,
        status: response.status,
        getServerTag,
      });
    },
    async requestStream(path, opts) {
      const { response, prepared } = await executeWithAuthRefresh(path, {
        ...opts,
        expectContentType: opts?.expectContentType ?? "binary",
      });
      if (!response.body) {
        throw new NetworkError("Response had no body to stream", {
          method: prepared.method,
          url: prepared.url,
          cause: "missing body",
        });
      }
      return response.body;
    },
  };
}

function buildUrl(
  baseUrl: string,
  path: string,
  query: Record<string, QueryValue> | undefined,
): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const target = new URL(baseUrl + normalizedPath);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) {
        continue;
      }
      if (Array.isArray(value)) {
        for (const entry of value) {
          target.searchParams.append(key, String(entry));
        }
      } else {
        target.searchParams.append(key, String(value));
      }
    }
  }
  return target.toString();
}

function acceptHeader(expected: ExpectedContentType): string {
  if (expected === "json") {
    return JSON_CONTENT_TYPE;
  }
  if (expected === "text") {
    return "text/*";
  }
  return "*/*";
}

function assertContentType(response: Response, prepared: PreparedRequest): void {
  if (prepared.expectContentType === "binary") {
    return;
  }
  const contentType = response.headers.get("content-type");
  if (contentType === null) {
    throwContentTypeMismatch(response, prepared, prepared.expectContentType);
  }
  if (prepared.expectContentType === "json" && !contentType.includes(JSON_CONTENT_TYPE)) {
    throwContentTypeMismatch(response, prepared, "json");
  }
  if (prepared.expectContentType === "text" && !contentType.startsWith(TEXT_CONTENT_TYPE_PREFIX)) {
    throwContentTypeMismatch(response, prepared, "text");
  }
}

function throwContentTypeMismatch(
  response: Response,
  prepared: PreparedRequest,
  expected: ExpectedContentType,
): never {
  const actual = response.headers.get("content-type") ?? "no content-type";
  throw new HttpError({
    status: response.status,
    statusText: response.statusText,
    method: prepared.method,
    url: prepared.url,
    responseHeaders: response.headers,
    rawBody: null,
    overrideUserMessage: `Expected ${expected} response but got ${actual}`,
  });
}

async function readBodyForError(response: Response): Promise<string | null> {
  try {
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.subarray(0, ERROR_BODY_BYTE_CAP).toString("utf8");
  } catch (error) {
    return `[body read failed: ${errorMessage(error)}]`;
  }
}
