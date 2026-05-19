import { isCancel } from "@clack/prompts";
import { core as zodCore, ZodError } from "zod";

import { escapeJsonPointerSegment } from "./json-pointer";

export const VERBOSE_ENV = "METABASE_VERBOSE";

export type ErrorCategory =
  | "network"
  | "http"
  | "validation"
  | "response-shape"
  | "timeout"
  | "config"
  | "capability"
  | "abort"
  | "docker"
  | "unknown";

export interface NetworkErrorDetail {
  method: string;
  url: string;
  cause: string;
}

export type TimeoutErrorDetail =
  | { kind: "http"; method: string; url: string; timeoutMs: number }
  | { kind: "polling"; timeoutMs: number; attempts: number };

export interface ValidationErrorDetail {
  source: string;
  zodIssues: ZodError["issues"];
}

export interface ResponseShapeErrorDetail {
  method: string;
  url: string;
  status: number;
  zodIssues: ZodError["issues"];
  serverTag: string | null;
}

export interface UnknownErrorDetail {
  originalMessage: string;
  stack: string | null;
}

export abstract class MetabaseError extends Error {
  abstract readonly category: ErrorCategory;
  abstract readonly isRetryable: boolean;
  abstract readonly exitCode: number;
  abstract readonly developerDetail: unknown;

  get userMessage(): string {
    return this.message;
  }
}

export class NetworkError extends MetabaseError {
  readonly category = "network";
  readonly isRetryable = true;
  readonly exitCode = 1;
  readonly developerDetail: NetworkErrorDetail;

  constructor(message: string, developerDetail: NetworkErrorDetail) {
    super(message);
    this.name = "NetworkError";
    this.developerDetail = developerDetail;
  }
}

export class TimeoutError extends MetabaseError {
  readonly category = "timeout";
  readonly isRetryable = true;
  readonly exitCode = 1;
  readonly developerDetail: TimeoutErrorDetail;

  constructor(message: string, developerDetail: TimeoutErrorDetail) {
    super(message);
    this.name = "TimeoutError";
    this.developerDetail = developerDetail;
  }
}

export class ValidationError extends MetabaseError {
  readonly category = "validation";
  readonly isRetryable = false;
  readonly exitCode = 1;
  readonly developerDetail: ValidationErrorDetail;

  constructor(message: string, developerDetail: ValidationErrorDetail) {
    super(message);
    this.name = "ValidationError";
    this.developerDetail = developerDetail;
  }

  override get userMessage(): string {
    const issues = this.developerDetail.zodIssues;
    if (issues.length === 0) {
      return this.message;
    }
    return `${this.message}\n${formatIssueLines(issues, VALIDATION_ISSUE_FORMAT)}`;
  }
}

const VALIDATION_MAX_ISSUES = 10;
const RESPONSE_SHAPE_MAX_ISSUES = 5;

const VALIDATION_ISSUE_FORMAT: IssueListFormat<ZodError["issues"][number]> = {
  max: VALIDATION_MAX_ISSUES,
  formatIssue: (issue) => `${formatZodIssuePointer(issue.path)}: ${issue.message}`,
};

const RESPONSE_SHAPE_ISSUE_FORMAT: IssueListFormat<ZodError["issues"][number]> = {
  max: RESPONSE_SHAPE_MAX_ISSUES,
  formatIssue: formatZodIssue,
};

interface IssueListFormat<T> {
  max: number;
  formatIssue: (issue: T) => string;
}

function formatIssueLines<T>(issues: ReadonlyArray<T>, format: IssueListFormat<T>): string {
  const head = issues.slice(0, format.max).map(format.formatIssue);
  const overflow = issues.length - format.max;
  if (overflow > 0) {
    head.push(`... and ${overflow} more`);
  }
  return head.map((line) => `  ${line}`).join("\n");
}

function formatZodIssuePointer(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) {
    return "/";
  }
  return path.map((key) => `/${escapeJsonPointerSegment(key)}`).join("");
}

const RESPONSE_SHAPE_LEAD_UNKNOWN_VERSION = "Metabase returned unexpected response shape";

export class ResponseShapeError extends MetabaseError {
  readonly category = "response-shape";
  readonly isRetryable = false;
  readonly exitCode = 1;
  readonly developerDetail: ResponseShapeErrorDetail;

  constructor(developerDetail: ResponseShapeErrorDetail) {
    super(formatResponseShapeMessage(developerDetail.zodIssues, developerDetail.serverTag));
    this.name = "ResponseShapeError";
    this.developerDetail = developerDetail;
  }
}

function formatResponseShapeMessage(issues: ZodError["issues"], serverTag: string | null): string {
  const lead =
    serverTag === null
      ? RESPONSE_SHAPE_LEAD_UNKNOWN_VERSION
      : `On Metabase ${serverTag} the response shape was unexpected`;
  if (issues.length === 0) {
    return lead;
  }
  return `${lead}:\n${formatIssueLines(issues, RESPONSE_SHAPE_ISSUE_FORMAT)}`;
}

export class ConfigError extends MetabaseError {
  readonly category = "config";
  readonly isRetryable = false;
  readonly exitCode = 2;
  readonly developerDetail = null;

  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export class AbortError extends MetabaseError {
  readonly category = "abort";
  readonly isRetryable = false;
  readonly exitCode = 130;
  readonly developerDetail = null;

  constructor(message = "aborted") {
    super(message);
    this.name = "AbortError";
  }
}

export class ChainedRequestError extends MetabaseError {
  override readonly cause: MetabaseError;

  constructor(message: string, cause: MetabaseError) {
    super(message);
    this.name = "ChainedRequestError";
    this.cause = cause;
  }

  override get category(): ErrorCategory {
    return this.cause.category;
  }

  override get isRetryable(): boolean {
    return this.cause.isRetryable;
  }

  override get exitCode(): number {
    return this.cause.exitCode;
  }

  override get developerDetail(): unknown {
    return this.cause.developerDetail;
  }
}

export class UnknownError extends MetabaseError {
  readonly category = "unknown";
  readonly isRetryable = false;
  readonly exitCode = 1;
  readonly developerDetail: UnknownErrorDetail;

  constructor(input: UnknownErrorDetail) {
    super(input.originalMessage);
    this.name = "UnknownError";
    this.developerDetail = input;
  }
}

export function toMetabaseError(error: unknown): MetabaseError {
  if (error instanceof MetabaseError) {
    return error;
  }
  if (isCancel(error)) {
    return new AbortError();
  }
  if (error instanceof ZodError) {
    return new ConfigError(error.issues.map(formatZodIssue).join("; "));
  }
  if (error instanceof Error) {
    return new UnknownError({ originalMessage: error.message, stack: error.stack ?? null });
  }
  return new UnknownError({ originalMessage: String(error), stack: null });
}

export function formatZodIssue(issue: ZodError["issues"][number]): string {
  const path = zodCore.toDotPath(issue.path);
  return path === "" ? issue.message : `${path}: ${issue.message}`;
}

export function isNotFoundError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value && value.code === "ENOENT";
}

export function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
