import type { ZodType } from "zod";

import packageJson from "../../../package.json" with { type: "json" };
import {
  errorMessage,
  NetworkError,
  ResponseShapeError,
  TimeoutError,
  ValidationError,
} from "../errors";
import { JSON_CONTENT_TYPE, parseJson } from "../../runtime/json";
import { combineAborts, throwIfAborted } from "../../runtime/signal";

import { HttpError, isRetryableStatus } from "./errors";
import { backoffDelay, DEFAULT_MAX_RETRIES, runWithRetries, type RetryOutcome } from "./retry";
import type { RedactionContext } from "./sanitize";

export type HttpMethod = "GET" | "HEAD" | "OPTIONS" | "POST" | "PUT" | "PATCH" | "DELETE";
export type ExpectedContentType = "json" | "text" | "binary";

const DEFAULT_TIMEOUT_MS = 30_000;
const OCTET_STREAM_CONTENT_TYPE = "application/octet-stream";
const TEXT_CONTENT_TYPE_PREFIX = "text/";
const ERROR_BODY_BYTE_CAP = 64 * 1024;
export const USER_AGENT = `metabase-cli/${packageJson.version}`;

const IDEMPOTENT_METHODS: ReadonlySet<HttpMethod> = new Set(["GET", "HEAD", "OPTIONS"]);

export type QueryPrimitive = string | number | boolean;
export type QueryValue = QueryPrimitive | ReadonlyArray<QueryPrimitive> | undefined;

export interface RequestOptions {
  method?: HttpMethod;
  query?: Record<string, QueryValue>;
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
  idempotent?: boolean;
  expectContentType?: ExpectedContentType;
}

export interface Client {
  requestParsed<T>(schema: ZodType<T>, path: string, opts?: RequestOptions): Promise<T>;
  requestRaw(path: string, opts?: RequestOptions): Promise<Response>;
  requestStream(path: string, opts?: RequestOptions): Promise<ReadableStream<Uint8Array>>;
}

export interface ClientCredentials {
  url: string;
  apiKey: string;
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
  callerSignal: AbortSignal | undefined;
}

export type ServerTagResolver = () => Promise<string | null>;

export interface ClientOverrides {
  fetchImpl?: typeof fetch;
  getServerTag?: ServerTagResolver;
}

const NO_SERVER_TAG: ServerTagResolver = async () => null;

export function createClient(config: ClientCredentials, overrides: ClientOverrides = {}): Client {
  const fetchImpl = overrides.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const getServerTag = overrides.getServerTag ?? NO_SERVER_TAG;
  const redactionContext: RedactionContext = {
    knownSecrets: new Set([config.apiKey]),
  };

  async function attemptOnce(prepared: PreparedRequest, attempt: number): Promise<RetryOutcome> {
    const hasRetriesLeft = attempt < prepared.retries;
    const timeoutSignal = AbortSignal.timeout(prepared.timeoutMs);
    const { combined, processSignal } = combineAborts(timeoutSignal, prepared.callerSignal);

    let response: Response;
    try {
      response = await fetchImpl(prepared.url, {
        method: prepared.method,
        headers: prepared.headers,
        body: prepared.body,
        signal: combined,
      });
    } catch (error) {
      throwIfAborted(prepared.callerSignal, processSignal);
      if (hasRetriesLeft) {
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
    return runWithRetries((attempt) => attemptOnce(prepared, attempt), prepared.callerSignal);
  }

  function prepare(path: string, opts: RequestOptions = {}): PreparedRequest {
    const method = opts.method ?? "GET";
    const expectContentType = opts.expectContentType ?? "json";
    const url = buildUrl(config.url, path, opts.query);
    const headers = new Headers();
    headers.set("x-api-key", config.apiKey);
    headers.set("accept", acceptHeader(expectContentType));
    headers.set("user-agent", USER_AGENT);
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
      callerSignal: opts.signal,
    };
  }

  return {
    async requestRaw(path, opts) {
      return executeRaw(prepare(path, opts));
    },
    async requestParsed(schema, path, opts) {
      const prepared = prepare(path, { ...opts, expectContentType: "json" });
      const response = await executeRaw(prepared);
      const text = await response.text();
      try {
        return parseJson(text, schema, { source: prepared.url });
      } catch (error) {
        if (error instanceof ValidationError) {
          throw new ResponseShapeError({
            method: prepared.method,
            url: prepared.url,
            status: response.status,
            zodIssues: error.developerDetail.zodIssues,
            serverTag: await getServerTag(),
          });
        }
        throw error;
      }
    },
    async requestStream(path, opts) {
      const prepared = prepare(path, {
        ...opts,
        expectContentType: opts?.expectContentType ?? "binary",
      });
      const response = await executeRaw(prepared);
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

interface NetworkTarget {
  host: string;
  hostname: string;
}

const NETWORK_HINTS: Record<string, (target: NetworkTarget) => string> = {
  ECONNREFUSED: (t) =>
    `Connection refused by ${t.host} — is Metabase running and is the port correct?`,
  ENOTFOUND: (t) => `Host not found: ${t.hostname} — check the URL.`,
  EAI_AGAIN: (t) => `Could not resolve ${t.hostname} — check your network connection and the URL.`,
  ECONNRESET: (t) =>
    `Connection to ${t.host} was reset — the server may have closed it, or http/https may be mismatched.`,
  ETIMEDOUT: (t) => `Connection to ${t.host} timed out — check the host, port, and your network.`,
};

const TLS_ERROR_CODES: ReadonlySet<string> = new Set([
  "EPROTO",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

function buildNetworkError(error: unknown, method: HttpMethod, url: string): NetworkError {
  const fallback = errorMessage(error);
  const code = causeCode(error);
  const target = networkTarget(url);
  return new NetworkError(networkMessage(code, target, fallback), {
    method,
    url,
    cause: code ?? fallback,
  });
}

function networkMessage(code: string | null, target: NetworkTarget, fallback: string): string {
  if (code === null) {
    return `Could not reach Metabase: ${fallback}`;
  }
  if (TLS_ERROR_CODES.has(code)) {
    return (
      `Could not reach Metabase: TLS error contacting ${target.host} (${code}) — ` +
      `the certificate could not be verified, or https:// was used against a plain-HTTP server.`
    );
  }
  const hint = NETWORK_HINTS[code];
  if (hint === undefined) {
    return `Could not reach Metabase: ${fallback} (${code})`;
  }
  return `Could not reach Metabase: ${hint(target)}`;
}

function causeCode(error: unknown): string | null {
  const cause = error instanceof Error ? error.cause : undefined;
  if (cause instanceof Error && "code" in cause && typeof cause.code === "string") {
    return cause.code;
  }
  return null;
}

function networkTarget(url: string): NetworkTarget {
  const parsed = new URL(url);
  return { host: parsed.host, hostname: parsed.hostname };
}

async function readBodyForError(response: Response): Promise<string | null> {
  try {
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.subarray(0, ERROR_BODY_BYTE_CAP).toString("utf8");
  } catch (error) {
    return `[body read failed: ${errorMessage(error)}]`;
  }
}
