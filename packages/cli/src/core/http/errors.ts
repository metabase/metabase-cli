import { z } from "zod";

import { MetabaseError } from "../errors";
import { JSON_CONTENT_TYPE, parseJsonResult } from "../../runtime/json";
import { isPlainObject } from "../../runtime/predicates";

import { redactBody, redactHeaders, type RedactionContext } from "./sanitize";

export type HttpErrorKind =
  | "route-missing"
  | "resource-missing"
  | "auth"
  | "rate-limit"
  | "server-error"
  | "generic";

interface StatusClassification {
  retryable: boolean;
  message?: string;
}

const ROUTE_MISSING_LITERAL = "API endpoint does not exist.";
const RESOURCE_MISSING_LITERAL = "Not found.";

const STATUS_CLASSIFICATIONS: Record<number, StatusClassification> = {
  401: { retryable: false },
  403: { retryable: false },
  404: { retryable: false },
  408: { retryable: true, message: "Metabase timed out responding." },
  425: { retryable: true },
  429: { retryable: true, message: "Metabase rate-limited the request." },
  500: { retryable: true },
  502: { retryable: true },
  503: { retryable: true },
  504: { retryable: true, message: "Metabase timed out responding." },
};

const ErrorEnvelope = z
  .object({
    message: z.string().optional(),
    error: z.string().optional(),
    "error-message": z.string().optional(),
    via: z.array(z.object({ message: z.string().optional() }).loose()).optional(),
    "specific-errors": z.unknown().optional(),
    errors: z.unknown().optional(),
  })
  .loose();

const MAX_EXTRACTED_MESSAGE_LEN = 500;
const ELLIPSIS = "…";

export interface HttpErrorDetail {
  status: number;
  statusText: string;
  method: string;
  url: string;
  responseHeaders: Record<string, string>;
  body: string | null;
}

export interface HttpErrorInput {
  status: number;
  statusText: string;
  method: string;
  url: string;
  responseHeaders: Headers | Record<string, string>;
  rawBody: string | null;
  serverTag?: string | null;
  overrideUserMessage?: string;
  redactionContext?: RedactionContext;
}

export class HttpError extends MetabaseError {
  readonly category = "http";
  readonly exitCode = 1;
  readonly status: number;
  readonly kind: HttpErrorKind;
  readonly developerDetail: HttpErrorDetail;

  constructor(input: HttpErrorInput) {
    const sanitizedBody = sanitizeBody(input.rawBody, input.redactionContext);
    const redactedHeaders = redactHeaders(input.responseHeaders);
    const kind = classifyKind(input.status, sanitizedBody, redactedHeaders);
    super(input.overrideUserMessage ?? buildUserMessage(kind, input, sanitizedBody));
    this.name = "HttpError";
    this.status = input.status;
    this.kind = kind;
    this.developerDetail = {
      status: input.status,
      statusText: input.statusText,
      method: input.method,
      url: input.url,
      responseHeaders: redactedHeaders,
      body: sanitizedBody,
    };
  }

  get isRetryable(): boolean {
    return isRetryableStatus(this.status);
  }
}

export function isRetryableStatus(status: number): boolean {
  return STATUS_CLASSIFICATIONS[status]?.retryable === true;
}

function sanitizeBody(rawBody: string | null, ctx: RedactionContext | undefined): string | null {
  if (rawBody === null) {
    return null;
  }
  if (ctx === undefined) {
    return rawBody;
  }
  return redactBody(rawBody, ctx);
}

function classifyKind(
  status: number,
  sanitizedBody: string | null,
  redactedHeaders: Record<string, string>,
): HttpErrorKind {
  if (status === 401 || status === 403) {
    return "auth";
  }
  if (status === 404) {
    return isRouteMissingResponse(sanitizedBody, redactedHeaders)
      ? "route-missing"
      : "resource-missing";
  }
  if (status === 429) {
    return "rate-limit";
  }
  if (status >= 500 && status < 600) {
    return "server-error";
  }
  return "generic";
}

function isRouteMissingResponse(
  sanitizedBody: string | null,
  redactedHeaders: Record<string, string>,
): boolean {
  if (sanitizedBody?.includes(ROUTE_MISSING_LITERAL)) {
    return true;
  }
  // Metabase ≤ v0.58 serves resource-missing 404s as text/plain "Not found." (newer
  // versions use a JSON envelope); without this the plain-text body falls through to the
  // non-JSON branch below and is misread as a missing route.
  if (sanitizedBody?.includes(RESOURCE_MISSING_LITERAL)) {
    return false;
  }
  if (redactedHeaders["content-type"]?.includes(JSON_CONTENT_TYPE)) {
    return false;
  }
  if (sanitizedBody === null || sanitizedBody.trim() === "") {
    return true;
  }
  return !parseJsonResult(sanitizedBody, ErrorEnvelope).ok;
}

function buildUserMessage(
  kind: HttpErrorKind,
  input: HttpErrorInput,
  sanitizedBody: string | null,
): string {
  if (kind === "route-missing") {
    return buildRouteMissingMessage(input);
  }
  if (kind === "resource-missing") {
    return `Not found: ${input.method} ${pathFromUrl(input.url)}.`;
  }
  // Messages we generate read as full sentences ending in a period; messages quoted from a
  // Metabase response envelope (parseEnvelopeMessage) are passed through verbatim, periods or not.
  const fromBody = parseEnvelopeMessage(sanitizedBody);
  if (fromBody !== null) {
    return fromBody;
  }
  if (kind === "auth") {
    return `Invalid or unauthorized API key (host: ${hostFromUrl(input.url)}).`;
  }
  return defaultMessageForStatus(input.status);
}

function buildRouteMissingMessage(input: HttpErrorInput): string {
  const path = pathFromUrl(input.url);
  if (!input.serverTag) {
    return `This endpoint is not available on the connected Metabase: ${input.method} ${path}.`;
  }
  return (
    `This endpoint is not available on Metabase ${input.serverTag}: ${input.method} ${path}. ` +
    `The command may require a newer Metabase major version. ` +
    `Run 'mb auth list' to see this server's version.`
  );
}

function pathFromUrl(url: string): string {
  const parsed = new URL(url);
  return parsed.pathname + parsed.search;
}

function hostFromUrl(url: string): string {
  return new URL(url).host;
}

function parseEnvelopeMessage(sanitizedBody: string | null): string | null {
  if (!sanitizedBody) {
    return null;
  }
  const result = parseJsonResult(sanitizedBody, ErrorEnvelope);
  if (!result.ok) {
    return null;
  }
  const envelope = result.value;
  const topLevel = envelope.message ?? envelope.error ?? envelope["error-message"];
  if (topLevel) {
    return capLength(topLevel);
  }
  const viaMessage = envelope.via?.find((entry) => entry.message)?.message;
  if (viaMessage) {
    return capLength(viaMessage);
  }
  const specific = formatErrorTree(envelope["specific-errors"]);
  if (specific) {
    return capLength(specific);
  }
  const generic = formatErrorTree(envelope.errors);
  if (generic) {
    return capLength(generic);
  }
  return null;
}

interface LeafEntry {
  path: string;
  message: string;
}

function formatErrorTree(value: unknown): string | null {
  const entries = collectLeafEntries(value, []);
  if (entries.length === 0) {
    return null;
  }
  return entries.map(formatLeafEntry).join("; ");
}

function formatLeafEntry(entry: LeafEntry): string {
  return entry.path === "" ? entry.message : `${entry.path}: ${entry.message}`;
}

function collectLeafEntries(value: unknown, path: ReadonlyArray<string>): LeafEntry[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? [] : [{ path: path.join("."), message: trimmed }];
  }
  if (Array.isArray(value)) {
    const messages = value.filter(
      (entry): entry is string => typeof entry === "string" && entry.trim() !== "",
    );
    if (messages.length === 0) {
      return [];
    }
    return [{ path: path.join("."), message: messages.join("; ") }];
  }
  if (isPlainObject(value)) {
    return Object.entries(value).flatMap(([key, child]) =>
      collectLeafEntries(child, [...path, key]),
    );
  }
  return [];
}

function capLength(message: string): string {
  if (message.length <= MAX_EXTRACTED_MESSAGE_LEN) {
    return message;
  }
  return message.slice(0, MAX_EXTRACTED_MESSAGE_LEN - ELLIPSIS.length) + ELLIPSIS;
}

function defaultMessageForStatus(status: number): string {
  return STATUS_CLASSIFICATIONS[status]?.message ?? `Metabase returned ${status}.`;
}
