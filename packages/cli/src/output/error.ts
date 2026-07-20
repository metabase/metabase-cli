import { consumeLegacyEnvWarnings, ENV_VERBOSE, readEnv } from "../core/env";
import { toMetabaseError } from "../core/errors";
import type { ErrorCategory, MetabaseError } from "../core/errors";

import { warn } from "./notice";
import { serializeJson } from "./render";
import type { Format } from "./types";

const VERBOSE_BREADCRUMB = "(rerun with MB_VERBOSE=1 for details)";

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
  const handled = toMetabaseError(error);
  const verbose = readEnv(ENV_VERBOSE) === "1";
  if (format === "json") {
    writeJsonError(handled, verbose);
  } else {
    writeTextError(handled, verbose);
  }
  for (const message of consumeLegacyEnvWarnings()) {
    warn(message);
  }
  process.exitCode = handled.exitCode;
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

function writeJsonError(handled: MetabaseError, verbose: boolean): void {
  const payload: JsonErrorPayload = {
    category: handled.category,
    message: handled.userMessage,
    exitCode: handled.exitCode,
  };
  if (verbose && handled.developerDetail !== null) {
    payload.detail = handled.developerDetail;
  }
  const envelope: JsonErrorEnvelope = { ok: false, error: payload };
  process.stderr.write(serializeJson(envelope, stderrPretty()) + "\n");
}
