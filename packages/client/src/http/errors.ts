import { z } from "zod";

import { ChainedRequestError, MetabaseError } from "../errors";
import { JSON_CONTENT_TYPE, parseJsonResult } from "../json";
import { isPlainObject } from "../predicates";

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

const NOT_FOUND_STATUS = 404;

const TEXT_CONTENT_TYPE = "text/plain";
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

interface FieldErrorBranch {
  [field: string]: FieldErrorNode;
}

type FieldErrorNode = string | string[] | FieldErrorBranch;

const FieldErrorNodeSchema: z.ZodType<FieldErrorNode> = z.lazy(() =>
  z.union([z.string(), z.array(z.string()), z.record(z.string(), FieldErrorNodeSchema)]),
);

const FieldErrorTree = z.record(z.string(), FieldErrorNodeSchema);

// Field name to the message Metabase rejected it with. A nested rejection is keyed by its
// dot-joined path (`prefs.site_locale`), and a field the server gave several reasons for carries
// them joined, so one string always answers "what is wrong with this field".
export type FieldErrors = Record<string, string>;

const FIELD_MESSAGE_SEPARATOR = "; ";

const MAX_EXTRACTED_MESSAGE_LEN = 500;
const ELLIPSIS = "…";

export interface HttpErrorDetail {
  status: number;
  statusText: string;
  method: string;
  url: string;
  responseHeaders: Record<string, string>;
  body: string | null;
  fieldErrors: FieldErrors | null;
  specificFieldErrors: FieldErrors | null;
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
  readonly status: number;
  readonly kind: HttpErrorKind;
  readonly developerDetail: HttpErrorDetail;

  constructor(input: HttpErrorInput) {
    const sanitizedBody = sanitizeBody(input.rawBody, input.redactionContext);
    const redactedHeaders = redactHeaders(input.responseHeaders);
    const kind = classifyKind(input.status, sanitizedBody, redactedHeaders);
    super(
      input.overrideUserMessage ?? buildUserMessage(kind, input, sanitizedBody, redactedHeaders),
    );
    const fields = extractFieldErrors(sanitizedBody);
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
      fieldErrors: fields.fieldErrors,
      specificFieldErrors: fields.specificFieldErrors,
    };
  }

  get isRetryable(): boolean {
    return isRetryableStatus(this.status);
  }

  // What the server said about each field it rejected, from the envelope's `errors` map: the
  // humanised requirement ("value must be a non-blank string.").
  get fieldErrors(): FieldErrors | null {
    return this.developerDetail.fieldErrors;
  }

  // The same fields from the envelope's `specific-errors` map, which names what arrived
  // ("missing required key, received: nil") rather than what was required.
  get specificFieldErrors(): FieldErrors | null {
    return this.developerDetail.specificFieldErrors;
  }
}

// Answers the status alone. `HttpError.kind` splits the same 404 into `route-missing` (this
// Metabase does not serve the route) and `resource-missing` (it does, and the row is gone); a caller
// that has to tell those apart reads `kind` instead.
export function isHttpNotFound(error: unknown): boolean {
  return error instanceof HttpError && error.status === NOT_FOUND_STATUS;
}

// Reports a failure that followed an already-successful request under `message`, keeping the wire
// truth of the failure itself. An `HttpError` is rebuilt rather than wrapped, because a caller that
// reads `status` or `fieldErrors` off the failure must still find them; every other error keeps its
// category and retryability through `ChainedRequestError`.
export function chainRequestFailure(cause: MetabaseError, message: string): MetabaseError {
  if (cause instanceof HttpError) {
    return new HttpError({
      status: cause.status,
      statusText: cause.developerDetail.statusText,
      method: cause.developerDetail.method,
      url: cause.developerDetail.url,
      responseHeaders: cause.developerDetail.responseHeaders,
      rawBody: cause.developerDetail.body,
      overrideUserMessage: message,
    });
  }
  return new ChainedRequestError(message, cause);
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
  if (status === NOT_FOUND_STATUS) {
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
  return parseEnvelope(sanitizedBody) === null;
}

function buildUserMessage(
  kind: HttpErrorKind,
  input: HttpErrorInput,
  sanitizedBody: string | null,
  redactedHeaders: Record<string, string>,
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
  const fromText = plainTextMessage(sanitizedBody, redactedHeaders);
  if (fromText !== null) {
    return fromText;
  }
  return defaultMessageForStatus(input.status);
}

// Metabase answers some rejections — a query that fails normalization, for one — with a text/plain
// body that is nothing but the message. Only that content type is read as one: an HTML error page
// from whatever sits in front of Metabase is never a message.
function plainTextMessage(
  sanitizedBody: string | null,
  redactedHeaders: Record<string, string>,
): string | null {
  if (sanitizedBody === null || !redactedHeaders["content-type"]?.includes(TEXT_CONTENT_TYPE)) {
    return null;
  }
  const trimmed = sanitizedBody.trim();
  return trimmed === "" ? null : capLength(trimmed);
}

function buildRouteMissingMessage(input: HttpErrorInput): string {
  const path = pathFromUrl(input.url);
  if (!input.serverTag) {
    return `This endpoint is not available on the connected Metabase: ${input.method} ${path}.`;
  }
  return (
    `This endpoint is not available on Metabase ${input.serverTag}: ${input.method} ${path}. ` +
    `It may require a newer Metabase major version.`
  );
}

function pathFromUrl(url: string): string {
  const parsed = new URL(url);
  return parsed.pathname + parsed.search;
}

function hostFromUrl(url: string): string {
  return new URL(url).host;
}

type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

function parseEnvelope(sanitizedBody: string | null): ErrorEnvelope | null {
  if (!sanitizedBody) {
    return null;
  }
  const result = parseJsonResult(sanitizedBody, ErrorEnvelope);
  return result.ok ? result.value : null;
}

interface FieldErrorViews {
  fieldErrors: FieldErrors | null;
  specificFieldErrors: FieldErrors | null;
}

const NO_FIELD_ERRORS: FieldErrorViews = { fieldErrors: null, specificFieldErrors: null };

// Read off the sanitized body rather than the raw one, so a secret quoted back inside a field
// message is already redacted by the time it reaches this typed surface.
function extractFieldErrors(sanitizedBody: string | null): FieldErrorViews {
  const envelope = parseEnvelope(sanitizedBody);
  if (envelope === null) {
    return NO_FIELD_ERRORS;
  }
  return {
    fieldErrors: parseFieldErrors(envelope.errors),
    specificFieldErrors: parseFieldErrors(envelope["specific-errors"]),
  };
}

// An HTTP failure is already the error path, so a value the field-error shape does not recognise
// costs the caller the structured view and nothing else — the status and message it came for
// survive untouched.
function parseFieldErrors(value: unknown): FieldErrors | null {
  const parsed = FieldErrorTree.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  const entries = collectLeafEntries(parsed.data, []);
  if (entries.length === 0) {
    return null;
  }
  return Object.fromEntries(entries.map((entry) => [entry.path, entry.message]));
}

function parseEnvelopeMessage(sanitizedBody: string | null): string | null {
  const envelope = parseEnvelope(sanitizedBody);
  if (envelope === null) {
    return null;
  }
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
  return entries.map(formatLeafEntry).join(FIELD_MESSAGE_SEPARATOR);
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
    return [{ path: path.join("."), message: messages.join(FIELD_MESSAGE_SEPARATOR) }];
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
