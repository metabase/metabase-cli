import type { ZodType } from "zod";

import { SessionProperties } from "../domain/session-properties";
import { AbortError, errorMessage, MetabaseError, NetworkError, TimeoutError } from "../errors";
import { JSON_CONTENT_TYPE } from "../json";
import { combineAborts, throwIfAborted, untilAborted } from "../signal";
import { normalizeUrl } from "../url";
import type { FeatureName } from "../version/features";
import { CapabilityError } from "../version/capability-error";
import { probeProperties, serverInfoFromProperties, type ServerInfo } from "../version/probe";
import { createServerProfile, type ServerProfile } from "../version/profile";
import { explainedFailure, mayBeRefusal } from "../version/refusal";
import { type CallRequirement, checkFeatures } from "../version/requirement-check";

import {
  assertCredentialHeaderSafe,
  type Credential,
  credentialAuthHeader,
  credentialSecrets,
  type CredentialRefresher,
} from "../auth/credential";

import { HttpError, isRetryableStatus } from "./errors";
import { buildNetworkError, isConnectionClosed } from "./network-error";
import { parseJsonResponse } from "./response-shape";
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
  // The profile a read chooses its shape by: the newest probe this client ran, else the one handed
  // in, else one probed now. A probe in flight is awaited, and its failure falls back to the profile
  // it would have replaced, so a read never fails on a probe it did not need. `signal` ends this
  // caller's wait; the probe itself is the client's and is cancelled only by the client's own
  // signal, so a later call still finds it settled.
  server(options?: WaitOptions): Promise<ServerProfile>;
  // A profile this client probed itself, never one handed in, for a verdict the server cannot give:
  // a profile cached before an upgrade or a license change would refuse what the server allows.
  // Every caller shares the probe in flight and the newest one settled; a failed one is not kept.
  verifiedServer(options?: WaitOptions): Promise<ServerProfile>;
  // The session properties read afresh through `reader`, as a probe `verifiedServer` then shares,
  // so a resource needing a setting they carry pays one request for both. The read is the caller's,
  // so it runs under the caller's `timeoutMs` and `retries` as any request does; `signal` ends only
  // this caller's wait, because the profile the read settles is the client's.
  probe<T extends SessionProperties>(reader: ZodType<T>, options?: ProbeReadOptions): Promise<T>;
  // Throws `CapabilityError` before the wire for features a method needs only because of the
  // parameters it was handed, where a server without them would drop the parameter and answer as
  // if it had never been sent. Judged against `verifiedServer`, never a profile handed in: a cache
  // that outlived a license would pass a parameter the server now drops, which is the silent answer
  // this check exists to prevent. An empty list resolves without consulting the server.
  requireFeatures(features: readonly FeatureName[], options?: WaitOptions): Promise<void>;
  // The error a call failed with, as a `CapabilityError` carrying the server's answer when the
  // server refused it for lacking one of the features `call` needs, and unchanged otherwise. The
  // explaining probe is bounded by its own timeout and the client's signal; the error stands when
  // the probe fails, and an interrupt surfaces as one.
  explainRefusal(call: CallRequirement, error: unknown): Promise<unknown>;
}

export type WaitOptions = Pick<RequestOptions, "signal">;
export type ProbeReadOptions = Pick<RequestOptions, "signal" | "timeoutMs" | "retries">;

interface Probed<T> {
  properties: T;
  profile: ServerProfile;
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
  // A profile the caller already holds — from its own cache, or from a probe it ran to verify the
  // credential — so the client never asks the server what the caller can tell it.
  server?: ServerProfile;
  // Names the server in an HTTP error, and in a shape error read with no profile in force. Defaults
  // to the tag of the profile in force; a caller that resolves the tag some other way passes its
  // own. A shape error read under a profile names that profile, the one its reader was chosen for.
  getServerTag?: ServerTagResolver;
  refreshCredential?: CredentialRefresher;
  // Called with the answer of every probe this client runs and the profile derived from it, so a
  // caller that handed in a cached profile can keep its cache as current as the server's last answer. Only the newest probe started
  // reaches it, so it never sees an older answer after a newer one. It is called before the calls
  // waiting on the probe resume and is not awaited: a caller with slow work to do (a cache write)
  // keeps the promise and settles it itself. A hook that throws fails the probe, which is then not
  // kept.
  onServerProbed?: (info: ServerInfo, profile: ServerProfile) => void;
  // Cancels every request this client makes; composed with the per-request `signal` and the
  // timeout. A process-level interrupt is the caller's to own and to hand over here.
  signal?: AbortSignal;
}

export function createTransport(config: ClientCredentials, options: ClientOptions): Transport {
  const baseUrl = normalizeUrl(config.url);
  assertCredentialHeaderSafe(config.credential);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  // The profile in force: the newest probe this client settled, else the one handed in. Errors name
  // it without awaiting a pending probe, because a shape error inside the probe would wait on itself.
  let inForce: ServerProfile | null = options.server ?? null;
  // This client's newest probe, in flight or settled, and dropped when it fails.
  let newest: Promise<Probed<SessionProperties>> | null = null;
  const getServerTag = options.getServerTag ?? (async () => tagOf(inForce));
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
      // A dropped connection or a timeout says nothing about whether a write landed, and Metabase
      // has no idempotency keys to tell a replay from a first delivery, so only a method safe to
      // repeat is resent (`idempotent: true` opts a write in). A pooled connection the peer reaped
      // between requests reports the socket's age, not the server's health, so it earns one attempt
      // on a fresh socket even when the caller opted out of retries.
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

    // Retrying a POST whose response was lost double-creates: a status code is only grounds for
    // another attempt when the method is safe to repeat.
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

  // The newest probe started is the only one that may settle the profile in force and reach the
  // hook, so an answer that lands after a later probe started never replaces it. A failed probe is
  // dropped, so the next call asks again rather than replaying one transient failure for the life of
  // the client.
  function startProbe<T extends SessionProperties>(
    reader: ZodType<T>,
    budget: Pick<RequestOptions, "timeoutMs" | "retries">,
  ): Promise<Probed<T>> {
    const probed = probeProperties(transport, reader, budget).then((properties) => {
      const info = serverInfoFromProperties(properties);
      const profile = createServerProfile(info);
      if (newest === probed) {
        options.onServerProbed?.(info, profile);
        inForce = profile;
      }
      return { properties, profile };
    });
    newest = probed;
    probed.then(undefined, () => {
      if (newest === probed) {
        newest = null;
      }
    });
    return probed;
  }

  function verifying(): Promise<ServerProfile> {
    const probing = newest ?? startProbe(SessionProperties, {});
    return probing.then((probed) => probed.profile);
  }

  function profileInForce(): Promise<ServerProfile> {
    const current = inForce;
    if (current === null) {
      return verifying();
    }
    if (newest === null) {
      return Promise.resolve(current);
    }
    return newest.then((probed) => probed.profile, fallBackTo(current));
  }

  async function server(wait: WaitOptions = {}): Promise<ServerProfile> {
    throwIfAborted(wait.signal);
    return untilAborted(profileInForce(), wait.signal);
  }

  async function verifiedServer(wait: WaitOptions = {}): Promise<ServerProfile> {
    throwIfAborted(wait.signal);
    return untilAborted(verifying(), wait.signal);
  }

  async function probe<T extends SessionProperties>(
    reader: ZodType<T>,
    read: ProbeReadOptions = {},
  ): Promise<T> {
    throwIfAborted(read.signal);
    const budget = {
      timeoutMs: read.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      retries: read.retries ?? DEFAULT_MAX_RETRIES,
    };
    const probed = await untilAborted(startProbe(reader, budget), read.signal);
    return probed.properties;
  }

  async function requireFeatures(
    features: readonly FeatureName[],
    wait: WaitOptions = {},
  ): Promise<void> {
    if (features.length === 0) {
      return;
    }
    const failure = checkFeatures(features, await verifiedServer(wait));
    if (failure !== null) {
      throw new CapabilityError(failure);
    }
  }

  // The server's own refusal is the verdict; the profile only names what was missing.
  async function explainRefusal(call: CallRequirement, error: unknown): Promise<unknown> {
    if (!mayBeRefusal(call, error)) {
      return error;
    }
    let profile: ServerProfile;
    try {
      profile = await verifiedServer();
    } catch (probeError) {
      if (probeError instanceof MetabaseError && !(probeError instanceof AbortError)) {
        return error;
      }
      throw probeError;
    }
    const failure = explainedFailure(call, profile, error);
    return failure === null ? error : new CapabilityError(failure, error);
  }

  const transport: Transport = {
    server,
    verifiedServer,
    probe,
    requireFeatures,
    explainRefusal,
    async requestRaw(path, opts) {
      return (await executeWithAuthRefresh(path, opts ?? {})).response;
    },
    async requestParsed(schema, path, opts) {
      // A resource chooses its reader by the profile in force just before it calls here, so a
      // shape error names that profile, whatever a probe settles while the request runs.
      const chosenFor = inForce;
      const { response, prepared } = await executeWithAuthRefresh(path, {
        ...opts,
        expectContentType: "json",
      });
      const text = await response.text();
      return parseJsonResponse(text, schema, {
        method: prepared.method,
        url: prepared.url,
        status: response.status,
        getServerTag: chosenFor === null ? getServerTag : async () => chosenFor.version.tag,
        serverSkew: chosenFor === null ? null : chosenFor.skew,
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
  return transport;
}

// A probe that fails is no reason to fail a read the profile it would have replaced can serve; an
// interrupt still ends the read.
function fallBackTo(profile: ServerProfile): (error: unknown) => ServerProfile {
  return (error) => {
    if (error instanceof MetabaseError && !(error instanceof AbortError)) {
      return profile;
    }
    throw error;
  };
}

function tagOf(profile: ServerProfile | null): string | null {
  return profile === null ? null : profile.version.tag;
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
