import { z } from "zod";

import { MetabaseError } from "../errors";
import { parseJsonResult } from "../../runtime/json";

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

const ErrorEnvelope = z.object({
  message: z.string().optional(),
  error: z.string().optional(),
  "error-message": z.string().optional(),
});

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
  return envelope.message ?? envelope.error ?? envelope["error-message"] ?? null;
}

function defaultMessageForStatus(status: number): string {
  return STATUS_CLASSIFICATIONS[status]?.message ?? `Metabase returned ${status}`;
}
