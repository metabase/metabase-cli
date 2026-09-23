import { once } from "node:events";

import { query, type ModelInfo, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

import type { ModelCatalog, ModelListingInput } from "../adapter";
import { newestPerTier, type Generation } from "../generations";

// The row that stands for whatever the account defaults to; the catalog names the real model instead.
const DEFAULT_ROW = "default";
const LISTING_TIMEOUT_MS = 15_000;
// `claude-opus-5-5[1m]`, `claude-haiku-4-5-20251001`: the tier, the release, then a dated snapshot or a context size.
const MODEL_ID = /^claude-([a-z]+)-(\d{1,2}(?:-\d{1,2})*)(?:-\d{8})?(?:\[\w+\])?$/u;

// A prompt that never yields holds the CLI at its handshake, so the listing reaches no model.
const NO_PROMPTS: AsyncIterable<SDKUserMessage> = {
  [Symbol.asyncIterator]: () => ({
    next: () => new Promise<IteratorResult<SDKUserMessage>>(() => undefined),
  }),
};

function generationOf(row: ModelInfo): Generation | null {
  if (row.resolvedModel === undefined) {
    return null;
  }
  const match = MODEL_ID.exec(row.resolvedModel);
  const tier = match?.[1];
  const version = match?.[2];
  if (tier === undefined || version === undefined) {
    return null;
  }
  return { tier, version: version.split("-").map(Number) };
}

function catalogOf(rows: readonly ModelInfo[]): ModelCatalog | null {
  const stated = rows.find((row) => row.value === DEFAULT_ROW);
  const named = newestPerTier(
    rows.filter((row) => row.value !== DEFAULT_ROW),
    generationOf,
  );
  const first = named[0];
  if (first === undefined) {
    return null;
  }
  const runsDefault = named.find(
    (row) => stated?.resolvedModel !== undefined && row.resolvedModel === stated.resolvedModel,
  );
  return {
    models: named.map((row) => ({
      id: row.value,
      label: row.displayName,
      resolvedId: row.resolvedModel ?? null,
    })),
    defaultModel: (runsDefault ?? first).value,
  };
}

// The CLI's handshake carries the models the signed-in account can use, with the one it defaults to.
export async function listClaudeModels(input: ModelListingInput): Promise<ModelCatalog | null> {
  const stop = AbortSignal.any([input.signal, AbortSignal.timeout(LISTING_TIMEOUT_MS)]);
  const handle = query({
    prompt: NO_PROMPTS,
    options: {
      pathToClaudeCodeExecutable: input.binaryPath,
      env: input.env,
      settingSources: ["user"],
    },
  });
  const gaveUp = once(stop, "abort").then(() => null);
  try {
    const init = await Promise.race([handle.initializationResult(), gaveUp]);
    return init === null ? null : catalogOf(init.models);
  } catch {
    return null;
  } finally {
    handle.close();
  }
}
