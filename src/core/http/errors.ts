import { z } from "zod";

import { MetabaseError } from "../errors";
import { parseJsonResult } from "../../runtime/json";
import { isPlainObject } from "../../runtime/predicates";

import { redactBody, redactHeaders, type RedactionContext } from "./sanitize";

interface StatusClassification {
  retryable: boolean;
  message?: string;
}

const STATUS_CLASSIFICATIONS: Record<number, StatusClassification> = {
  401: { retryable: false, message: "Invalid or unauthorized API key" },
  403: { retryable: false, message: "Invalid or unauthorized API key" },
  404: { retryable: false, message: "Endpoint not found — is this a Metabase instance?" },
  408: { retryable: true, message: "Metabase timed out responding" },
  425: { retryable: true },
  429: { retryable: true, message: "Metabase rate-limited the request" },
  500: { retryable: true },
  502: { retryable: true },
  503: { retryable: true },
  504: { retryable: true, message: "Metabase timed out responding" },
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
  overrideUserMessage?: string;
  redactionContext?: RedactionContext;
}

export class HttpError extends MetabaseError {
  readonly category = "http";
  readonly exitCode = 1;
  readonly status: number;
  readonly developerDetail: HttpErrorDetail;

  constructor(input: HttpErrorInput) {
    const sanitizedBody = sanitizeBody(input.rawBody, input.redactionContext);
    super(input.overrideUserMessage ?? extractUserMessage(input.status, sanitizedBody));
    this.name = "HttpError";
    this.status = input.status;
    this.developerDetail = {
      status: input.status,
      statusText: input.statusText,
      method: input.method,
      url: input.url,
      responseHeaders: redactHeaders(input.responseHeaders),
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

function extractUserMessage(status: number, sanitizedBody: string | null): string {
  const fromBody = parseEnvelopeMessage(sanitizedBody);
  if (fromBody) {
    return fromBody;
  }
  return defaultMessageForStatus(status);
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
  return STATUS_CLASSIFICATIONS[status]?.message ?? `Metabase returned ${status}`;
}
