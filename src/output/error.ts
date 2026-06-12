import { toMetabaseError, VERBOSE_ENV } from "../core/errors";
import type { ErrorCategory, MetabaseError } from "../core/errors";

import type { Format } from "./types";

const VERBOSE_BREADCRUMB = "(rerun with METABASE_VERBOSE=1 for details)";

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
  const verbose = process.env[VERBOSE_ENV] === "1";
  if (format === "json") {
    writeJsonError(handled, verbose);
  } else {
    writeTextError(handled, verbose);
  }
  process.exitCode = handled.exitCode;
}

function writeTextError(handled: MetabaseError, verbose: boolean): void {
  process.stderr.write(handled.userMessage + "\n");
  if (handled.developerDetail === null) {
    return;
  }
  if (verbose) {
    process.stderr.write(JSON.stringify(handled.developerDetail, null, 2) + "\n");
  } else {
    process.stderr.write(VERBOSE_BREADCRUMB + "\n");
  }
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
  process.stderr.write(JSON.stringify(envelope, null, 2) + "\n");
}
