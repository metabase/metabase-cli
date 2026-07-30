import { z } from "zod";

import { errorMessage, NetworkError, TimeoutError } from "@metabase/client/errors";
import { HttpError } from "@metabase/client/http/errors";
import { parseJson } from "@metabase/client/json";
import { combineAborts, throwIfAborted } from "@metabase/client/signal";

const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const DEFAULT_TIMEOUT_MS = 15_000;
const ERROR_BODY_BYTE_CAP = 8 * 1024;

const NpmDistTags = z
  .object({
    latest: z.string(),
  })
  .loose();
type NpmDistTags = z.infer<typeof NpmDistTags>;

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
    const rawBody = await readErrorBody(response);
    throw new HttpError({
      status: response.status,
      statusText: response.statusText,
      method: "GET",
      url,
      responseHeaders: response.headers,
      rawBody,
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
