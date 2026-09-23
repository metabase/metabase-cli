import { AbortError, toMetabaseError } from "@metabase/client/errors";
import type { ErrorCategory, MetabaseError } from "@metabase/client/errors";
import { ENV_VERBOSE, readEnv } from "../core/env";
import { isPromptCancel } from "./prompt";
import { serializeJson } from "./render";
import type { Format } from "./types";

const VERBOSE_BREADCRUMB = "(rerun with MB_VERBOSE=1 for details)";

const FAILURE_EXIT_CODE = 1;
const USAGE_EXIT_CODE = 2;
const INTERRUPTED_EXIT_CODE = 130;

// A process exit code is the CLI's policy, so the client's taxonomy carries none. The switch is total
// over the discriminant and has no `default`: a category added to the taxonomy stops compiling
// here until someone decides what it should exit with.
export function exitCodeFor(category: ErrorCategory): number {
  switch (category) {
    case "config":
    case "capability": {
      return USAGE_EXIT_CODE;
    }
    case "abort": {
      return INTERRUPTED_EXIT_CODE;
    }
    case "network":
    case "http":
    case "validation":
    case "response-shape":
    case "timeout":
    case "internal":
    case "unknown": {
      return FAILURE_EXIT_CODE;
    }
  }
}

interface JsonErrorPayload {
  category: ErrorCategory;
  message: string;
  exitCode: number;
  detail?: unknown;
}

interface JsonErrorEnvelope {
  ok: false;
  error: JsonErrorPayload;
}

export function reportError(error: unknown, format?: Format): void {
  const handled = isPromptCancel(error) ? new AbortError() : toMetabaseError(error);
  const verbose = readEnv(ENV_VERBOSE) === "1";
  const exitCode = exitCodeFor(handled.category);
  if (format === "json") {
    writeJsonError(handled, exitCode, verbose);
  } else {
    writeTextError(handled, verbose);
  }
  process.exitCode = exitCode;
}

function writeTextError(handled: MetabaseError, verbose: boolean): void {
  process.stderr.write(handled.userMessage + "\n");
  if (handled.developerDetail === null) {
    return;
  }
  if (verbose) {
    process.stderr.write(serializeJson(handled.developerDetail, stderrPretty()) + "\n");
  } else {
    process.stderr.write(VERBOSE_BREADCRUMB + "\n");
  }
}

function stderrPretty(): boolean {
  return process.stderr.isTTY === true;
}

function writeJsonError(handled: MetabaseError, exitCode: number, verbose: boolean): void {
  const payload: JsonErrorPayload = {
    category: handled.category,
    message: handled.userMessage,
    exitCode,
  };
  if (verbose && handled.developerDetail !== null) {
    payload.detail = handled.developerDetail;
  }
  const envelope: JsonErrorEnvelope = { ok: false, error: payload };
  process.stderr.write(serializeJson(envelope, stderrPretty()) + "\n");
}
