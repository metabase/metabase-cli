import { z } from "zod";

import { errorMessage, MetabaseError, NetworkError, TimeoutError } from "@metabase/client/errors";
import { parseJson, parseJsonResult } from "@metabase/client/json";
import { combineAborts, throwIfAborted } from "@metabase/client/signal";

import { SemverString } from "./semver";

export const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const DEFAULT_TIMEOUT_MS = 15_000;
const ERROR_BODY_BYTE_CAP = 8 * 1024;

// npm accepts only a valid version as a dist-tag's target, so every tag reads as one.
const NpmDistTags = z
  .object({
    latest: SemverString,
  })
  .catchall(SemverString);
export type NpmDistTags = z.infer<typeof NpmDistTags>;

// The registry's own refusal, `{ "error": "Not found" }`.
const NpmErrorBody = z.object({ error: z.string() }).loose();

interface NpmRegistryErrorDetail {
  status: number;
  url: string;
  rawBody: string | null;
}

// Kept apart from `HttpError`, whose wording and remedies speak of the Metabase the CLI is connected
// to, so a registry failure never reads as that server's.
export class NpmRegistryError extends MetabaseError {
  readonly category = "http";
  readonly isRetryable = false;
  readonly developerDetail: NpmRegistryErrorDetail;

  constructor(detail: NpmRegistryErrorDetail) {
    super(registryErrorMessage(detail));
    this.name = "NpmRegistryError";
    this.developerDetail = detail;
  }
}

function registryErrorMessage({ status, url, rawBody }: NpmRegistryErrorDetail): string {
  const answered = `npm registry answered HTTP ${status} for GET ${url}`;
  if (rawBody === null) {
    return answered;
  }
  const said = parseJsonResult(rawBody, NpmErrorBody);
  return said.ok ? `${answered}: ${said.value.error}` : answered;
}

export interface FetchDistTagsOptions {
  userAgent: string;
  registry?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export async function fetchNpmDistTags(
  packageName: string,
  opts: FetchDistTagsOptions,
): Promise<NpmDistTags> {
  const registry = opts.registry ?? DEFAULT_REGISTRY;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const url = buildDistTagsUrl(registry, packageName);
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combined = combineAborts(timeoutSignal, opts.signal);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/json", "user-agent": opts.userAgent },
      signal: combined,
    });
  } catch (error) {
    throwIfAborted(opts.signal);
    if (timeoutSignal.aborted) {
      throw new TimeoutError(`npm registry request timed out after ${timeoutMs}ms`, {
        kind: "http",
        method: "GET",
        url,
        timeoutMs,
      });
    }
    const cause = errorMessage(error);
    throw new NetworkError(`could not reach npm registry: ${cause}`, {
      method: "GET",
      url,
      cause,
    });
  }

  if (!response.ok) {
    throw new NpmRegistryError({
      status: response.status,
      url,
      rawBody: await readErrorBody(response),
    });
  }

  const text = await response.text();
  return parseJson(text, NpmDistTags, { source: url });
}

function buildDistTagsUrl(registry: string, packageName: string): string {
  const base = registry.replace(/\/+$/, "");
  // npm convention: keep `@` literal in the scope, encode only the `/` separator.
  const encoded = packageName.replace("/", "%2F");
  return `${base}/-/package/${encoded}/dist-tags`;
}

async function readErrorBody(response: Response): Promise<string | null> {
  try {
    const text = await response.text();
    return text.slice(0, ERROR_BODY_BYTE_CAP);
  } catch (error) {
    return `[body read failed: ${errorMessage(error)}]`;
  }
}
