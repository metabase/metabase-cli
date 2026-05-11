import { isCancel } from "@clack/prompts";
import { core as zodCore, ZodError } from "zod";

export const VERBOSE_ENV = "METABASE_VERBOSE";

export type ErrorCategory =
  | "network"
  | "http"
  | "validation"
  | "timeout"
  | "config"
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

const VALIDATION_ISSUE_PREVIEW_LIMIT = 5;

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
    const shown = issues.slice(0, VALIDATION_ISSUE_PREVIEW_LIMIT);
    const lines = shown.map((issue) => `  - ${formatZodIssue(issue)}`);
    const trailer =
      issues.length > shown.length
        ? `\n  …and ${issues.length - shown.length} more`
        : "";
    const hint = `\n  Set ${VERBOSE_ENV}=1 for the full developer detail.`;
    return `${this.message} (${issues.length} issue${issues.length === 1 ? "" : "s"})\n${lines.join("\n")}${trailer}${hint}`;
  }
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
