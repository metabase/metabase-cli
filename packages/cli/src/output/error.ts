import { AbortError, toMetabaseError } from "@metabase/client/errors";
import type { ErrorCategory, MetabaseError } from "@metabase/client/errors";
import type { PreflightFailure } from "@metabase/client/version/capabilities";

import { consumeLegacyEnvWarnings, ENV_VERBOSE, readEnv } from "../core/env";
import { warn } from "./notice";
import { isPromptCancel } from "./prompt";
import { serializeJson } from "./render";
import type { Format } from "./types";

const VERBOSE_BREADCRUMB = "(rerun with MB_VERBOSE=1 for details)";

// The client states the version floor; naming a release that clears it is the CLI's own business.
const DOWNGRADE_REMEDY = "Or install an `@metabase/cli` release that targets this server.";

// The client reports which server the endpoint is missing from but may not name a command to inspect
// it with, so the CLI supplies the one that prints the version it just quoted.
const ROUTE_MISSING_REMEDY = "Run `mb auth list` to see this server's version.";

const ROUTE_MISSING_KIND = "route-missing";

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
  for (const message of consumeLegacyEnvWarnings()) {
    warn(message);
  }
  process.exitCode = exitCode;
}

function isVersionTooOld(detail: unknown): detail is PreflightFailure {
  return (
    typeof detail === "object" &&
    detail !== null &&
    "reason" in detail &&
    detail.reason === "version-too-old"
  );
}

// `kind` belongs to `HttpError` alone, which `src/output/` may not import; no other error in the
// taxonomy carries the property, so reading it off the value is unambiguous.
function isRouteMissing(handled: MetabaseError): boolean {
  return "kind" in handled && handled.kind === ROUTE_MISSING_KIND;
}

// What the CLI adds to a message the client had to phrase without knowing who would print it. Both
// output formats carry them, so an agent reading `--json` gets the same remediation a human does.
function remediesFor(handled: MetabaseError): readonly string[] {
  if (isVersionTooOld(handled.developerDetail)) {
    return [DOWNGRADE_REMEDY];
  }
  if (isRouteMissing(handled)) {
    return [ROUTE_MISSING_REMEDY];
  }
  return [];
}

function writeTextError(handled: MetabaseError, verbose: boolean): void {
  process.stderr.write(handled.userMessage + "\n");
  for (const remedy of remediesFor(handled)) {
    process.stderr.write(remedy + "\n");
  }
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
    message: [handled.userMessage, ...remediesFor(handled)].join("\n"),
    exitCode,
  };
  if (verbose && handled.developerDetail !== null) {
    payload.detail = handled.developerDetail;
  }
  const envelope: JsonErrorEnvelope = { ok: false, error: payload };
  process.stderr.write(serializeJson(envelope, stderrPretty()) + "\n");
}
