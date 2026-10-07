import type { ZodType } from "zod";

import { SessionProperties } from "../domain/session-properties";
import {
  errorMessage,
  isNonInterruptFailure,
  type MetabaseError,
  NetworkError,
  TimeoutError,
} from "../errors";
import { JSON_CONTENT_TYPE } from "../json";
import { combineAborts, throwIfAborted, untilAborted } from "../signal";
import { normalizeUrl } from "../url";
import type { FeatureName } from "../version/features";
import { CapabilityError } from "../version/capability-error";
import {
  PROBE_PATH,
  probeBudget,
  type ProbeOptions,
  serverInfoFromProperties,
  type ServerInfo,
} from "../version/probe";
import { createServerProfile, type ServerProfile } from "../version/profile";
import { featureFailures } from "../version/requirement-check";

import {
  assertCredentialHeaderSafe,
  type Credential,
  credentialAuthHeader,
  credentialSecrets,
  type CredentialRefresher,
} from "../auth/credential";

import { HttpError, isRetryableStatus, UNAUTHORIZED_STATUS } from "./errors";
import { buildNetworkError, isConnectionClosed } from "./network-error";
import { parseJsonResponse, type ResponseContext } from "./response-shape";
import { backoffDelay, DEFAULT_MAX_RETRIES, runWithRetries, type RetryOutcome } from "./retry";
import type { RedactionContext } from "./sanitize";

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
  // The profile a read chooses its shape by: the profile in force, which is the newest probe answer
  // this client applied, else the one handed in, else one probed now. The newest probe started is
  // awaited while it is in flight, and its failure falls back to the profile in force by then, so a
  // read never fails on a probe it did not need. `signal` ends this caller's wait; the probe itself
  // is the client's and is cancelled only by the client's own signal, so a later call still finds
  // it settled.
  server(options?: WaitOptions): Promise<ServerProfile>;
  // A profile this client probed itself, never one handed in, for a verdict the server cannot give:
  // a profile cached before an upgrade or a license change would refuse what the server allows.
  // Every caller shares the newest probe started, in flight or settled. When it fails short of an
  // interrupt, the newest answer this client applied stands in for it, or else the failure does;
  // a call finding no probe and no answer starts one.
  verifiedServer(options?: WaitOptions): Promise<ServerProfile>;
  // The session properties read afresh, as a probe `server` and `verifiedServer` then share, and
  // handed to this caller alone through `reader`, so a resource needing a setting they carry pays
  // one request for both. The shared probe parses only what every caller needs, so a reader that
  // rejects the answer fails this call with the `ResponseShapeError` a read of its own would raise
  // and no other. The read runs on the probe's own budget, its timeout and no retries, unless the
  // caller sets `timeoutMs` or `retries`; `signal` ends only this caller's wait, because the profile
  // the read settles is the client's.
  probe<T extends SessionProperties>(reader: ZodType<T>, options?: ProbeReadOptions): Promise<T>;
  // Refuses with `CapabilityError`, through `refuseBeforeSending`, for features a method needs only
  // because of the parameters it was handed, where a server without them would drop the parameter
  // and answer as if it had never been sent. Judged against `preflightServer`, never a profile
  // handed in: a cache that outlived a license would pass a parameter the server now drops, which
  // is the silent answer this check exists to prevent. An empty list resolves without consulting
  // the server.
  requireFeatures(features: readonly FeatureName[], options?: WaitOptions): Promise<void>;
  // The profile a refusal before the wire judges by: `verifiedServer`, unless it fails short of an
  // interrupt while the caller skips such refusals (`onPreflightSkipped`). Then the caller is told
  // the check could not run and this answers null, so the call goes on unchecked; an interrupt
  // still ends it, and without the hook the failure does.
  preflightServer(options?: WaitOptions): Promise<ServerProfile | null>;
  // Throws `refusal`, made before the wire because the feature rules say the server would answer
  // the call wrongly without a word, unless the caller set `onPreflightSkipped`: then the refusal
  // is handed there and this returns, so the call goes on and the server answers it. Every refusal
  // judged by the rules rather than by the server's own state comes through here or through
  // `preflightServer`, which share the one decision whether the caller skips them.
  refuseBeforeSending(refusal: CapabilityError): void;
  // Resolves once no probe this client started is in flight, whatever each answered, and starts
  // none, so a caller about to exit has seen every answer `onServerProbed` will be handed. Each
  // probe is bounded by its own timeout and the client's signal, and so is the wait.
  probesSettled(): Promise<void>;
}

export type WaitOptions = Pick<RequestOptions, "signal">;
export type ProbeReadOptions = Pick<RequestOptions, "signal" | "timeoutMs" | "retries">;

// A check before the wire the caller skipped: one that would have refused, with the error it would
// have thrown, or one that could not run because the profile it judges by could not be had.
export interface PreflightRefused {
  kind: "refused";
  refusal: CapabilityError;
}

export interface PreflightUnverified {
  kind: "unverified";
  failure: MetabaseError;
}

export type SkippedPreflight = PreflightRefused | PreflightUnverified;

// A JSON body read off the wire and not yet parsed, with what a shape error in it names.
interface JsonRead {
  text: string;
  context: ResponseContext;
}

// The server a shape error names: its version tag and where that version sits in the known range.
type ServerNaming = Pick<ResponseContext, "getServerTag" | "serverSkew">;

// One probe's answer: the properties every caller needs, the profile they describe, and the body
// they came from, which a caller wanting a setting they carry parses again with its own reader.
interface Probed {
  properties: SessionProperties;
  profile: ServerProfile;
  read: JsonRead;
}

// A probe answer made the profile in force, with the order its probe started in.
interface AppliedProbe {
  order: number;
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
  // Called with the answer of every probe this client applies and the profile derived from it, so a
  // caller that handed in a cached profile can keep its cache as current as the server's last
  // answer. An answer is applied unless a probe started after its own has been applied already, so
  // the hook never sees an older answer after a newer one, and an answer outliving a later probe
  // that failed still reaches it. It is called before the calls waiting on the probe resume and is
  // not awaited: a caller with slow work to do (a cache write) keeps the promise and settles it
  // itself, after `probesSettled` when it must see every call. A hook that throws fails the probe,
  // which is then not applied.
  onServerProbed?: (info: ServerInfo, profile: ServerProfile) => void;
  // When set, a refusal the client would make before sending, because its feature rules say the
  // server cannot serve the call as asked, is handed here instead of thrown and the call goes on,
  // for a caller that knows better than the rules: a backported feature, or a rule that is wrong.
  // A server that truly lacks the feature may then drop or rewrite what it does not support and
  // answer without saying so. A check whose profile cannot be had, the probe failing short of an
  // interrupt, is handed here as unverified and the call goes on unchecked. It is called once for
  // every feature a call lacks, or once for the check that could not run, and is not awaited; a
  // hook that throws fails the call with that error. Refusals that read the server's own state,
  // input the client rejects, and a refusal the server answers are never handed here.
  onPreflightSkipped?: (skipped: SkippedPreflight) => void;
  // Cancels every request this client makes; composed with the per-request `signal` and the
  // timeout. A process-level interrupt is the caller's to own and to hand over here.
  signal?: AbortSignal;
}

export function createTransport(config: ClientCredentials, options: ClientOptions): Transport {
  const baseUrl = normalizeUrl(config.url);
  assertCredentialHeaderSafe(config.credential);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  // The profile in force: the newest probe answer this client applied, else the one handed in.
  // Errors name it without awaiting a pending probe, because a shape error inside the probe would
  // wait on itself.
  let inForce: ServerProfile | null = options.server ?? null;
  // This client's newest probe started, in flight or settled, and dropped when it fails.
  let newest: Promise<Probed> | null = null;
  let probesStarted = 0;
  let applied: AppliedProbe | null = null;
  const inFlight = new Set<Promise<Probed>>();
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

  async function readJson(path: string, opts: TransportRequestOptions = {}): Promise<JsonRead> {
    // A resource chooses its reader by the profile in force just before it calls here, so a shape
    // error names that profile, whatever a probe settles while the request runs.
    const chosenFor = inForce;
    const { response, prepared } = await executeWithAuthRefresh(path, {
      ...opts,
      expectContentType: "json",
    });
    return {
      text: await response.text(),
      context: {
        method: prepared.method,
        url: prepared.url,
        status: response.status,
        ...namingOf(chosenFor),
      },
    };
  }

  // With no profile in force, the tag is resolved only once a shape error asks for it.
  function namingOf(profile: ServerProfile | null): ServerNaming {
    if (profile === null) {
      return { getServerTag, serverSkew: null };
    }
    return { getServerTag: async () => profile.version.tag, serverSkew: profile.skew };
  }

  // Probes are ordered by when they started. An answer is applied, made the profile in force and
  // handed to the hook, unless a later-started probe has been applied already, so neither ever goes
  // back to an older answer, and an answer landing after a later probe failed still counts.
  async function runProbe(order: number, budget: ProbeOptions): Promise<Probed> {
    const read = await readJson(PROBE_PATH, probeBudget(budget));
    const properties = await parseJsonResponse(read.text, SessionProperties, read.context);
    const info = serverInfoFromProperties(properties);
    const profile = createServerProfile(info);
    if (applied === null || applied.order < order) {
      options.onServerProbed?.(info, profile);
      applied = { order, profile };
      inForce = profile;
    }
    return { properties, profile, read };
  }

  // Only the newest probe started is shared with the calls that come after it. A failed one is
  // dropped, so the next call asks again rather than replaying one transient failure for the life
  // of the client, unless an applied answer stands in for it.
  function startProbe(budget: ProbeOptions): Promise<Probed> {
    probesStarted += 1;
    const probed = runProbe(probesStarted, budget);
    newest = probed;
    inFlight.add(probed);
    probed.then(
      () => {
        inFlight.delete(probed);
      },
      () => {
        inFlight.delete(probed);
        if (newest === probed) {
          newest = null;
        }
      },
    );
    return probed;
  }

  function appliedProfile(): ServerProfile | null {
    return applied === null ? null : applied.profile;
  }

  function verifying(): Promise<ServerProfile> {
    const settled = appliedProfile();
    if (newest === null && settled !== null) {
      return Promise.resolve(settled);
    }
    const probing = newest ?? startProbe({});
    return probing.then((probed) => probed.profile, fallBackTo(appliedProfile));
  }

  function profileInForce(): Promise<ServerProfile> {
    const current = inForce;
    if (current === null) {
      return verifying();
    }
    if (newest === null) {
      return Promise.resolve(current);
    }
    return newest.then(
      (probed) => probed.profile,
      fallBackTo(() => inForce),
    );
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
    const { signal, ...budget } = read;
    throwIfAborted(signal);
    const probed = await untilAborted(startProbe(budget), signal);
    // The body a reader rejects reported the server's version itself, so the error names that
    // version, not the profile in force before the probe: a reader is chosen by no profile, and a
    // cached one that predates an upgrade would pass the failure off as a read made under it.
    const context = { ...probed.read.context, ...namingOf(probed.profile) };
    return parseJsonResponse(probed.read.text, reader, context);
  }

  async function probesSettled(): Promise<void> {
    while (inFlight.size > 0) {
      await Promise.allSettled(inFlight);
    }
  }

  async function requireFeatures(
    features: readonly FeatureName[],
    wait: WaitOptions = {},
  ): Promise<void> {
    if (features.length === 0) {
      return;
    }
    const profile = await preflightServer(wait);
    if (profile === null) {
      return;
    }
    for (const failure of featureFailures(features, profile)) {
      refuseBeforeSending(new CapabilityError(failure));
    }
  }

  async function preflightServer(wait: WaitOptions = {}): Promise<ServerProfile | null> {
    try {
      return await verifiedServer(wait);
    } catch (error) {
      if (!isNonInterruptFailure(error)) {
        throw error;
      }
      skipOrThrow({ kind: "unverified", failure: error });
      return null;
    }
  }

  function refuseBeforeSending(refusal: CapabilityError): void {
    skipOrThrow({ kind: "refused", refusal });
  }

  // The one decision whether the caller skips checks before the wire: `skipped` is handed to the
  // hook and the call goes on, or the error it carries is thrown.
  function skipOrThrow(skipped: SkippedPreflight): void {
    const hook = options.onPreflightSkipped;
    if (hook === undefined) {
      throw skippedError(skipped);
    }
    hook(skipped);
  }

  const transport: Transport = {
    server,
    verifiedServer,
    probe,
    requireFeatures,
    preflightServer,
    refuseBeforeSending,
    probesSettled,
    async requestRaw(path, opts) {
      return (await executeWithAuthRefresh(path, opts ?? {})).response;
    },
    async requestParsed(schema, path, opts) {
      const read = await readJson(path, opts);
      return parseJsonResponse(read.text, schema, read.context);
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

function skippedError(skipped: SkippedPreflight): MetabaseError {
  return skipped.kind === "refused" ? skipped.refusal : skipped.failure;
}

// A probe that fails is no reason to fail a call a profile already in hand can serve; an interrupt
// still ends the call, and so does the failure when there is no profile to fall back to.
function fallBackTo(fallback: () => ServerProfile | null): (error: unknown) => ServerProfile {
  return (error) => {
    const profile = fallback();
    if (profile !== null && isNonInterruptFailure(error)) {
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
