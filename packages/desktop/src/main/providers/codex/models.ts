import { once } from "node:events";
import { homedir } from "node:os";

import { startProcess } from "../../process/spawn";
import type { ModelCatalog, ModelListingInput } from "../adapter";
import { newestPerTier, type Generation } from "../generations";
import type { ProviderLog } from "../log";

import { CodexClient } from "./client";
import {
  CODEX_ARGS,
  CODEX_METHOD,
  InitializeResult,
  ModelListResult,
  type ModelListResult as ModelList,
} from "./protocol";
import { initializeParams } from "./session";

const LISTING_TIMEOUT_MS = 15_000;
// `gpt-6-astra`, `gpt-5.5`: the release, then the tier when the model has one.
const MODEL_ID = /^gpt-(\d+(?:\.\d+)*)(?:-([a-z]+))?$/u;

// A listing is not a session, so its frames go nowhere.
const UNLOGGED: ProviderLog = {
  write: () => undefined,
  close: () => Promise.resolve(),
};

function generationOf(id: string): Generation | null {
  const match = MODEL_ID.exec(id);
  const version = match?.[1];
  if (version === undefined) {
    return null;
  }
  return { tier: match?.[2] ?? null, version: version.split(".").map(Number) };
}

function catalogOf(list: ModelList): ModelCatalog | null {
  const shown = newestPerTier(
    list.data.filter((entry) => !entry.hidden),
    (entry) => generationOf(entry.id),
  );
  const first = shown[0];
  if (first === undefined) {
    return null;
  }
  const stated = shown.find((entry) => entry.isDefault) ?? first;
  return {
    models: shown.map((entry) => ({ id: entry.id, label: entry.displayName, resolvedId: null })),
    defaultModel: stated.id,
  };
}

// The app server answers `model/list` before any thread exists, so the listing reaches no model.
export async function listCodexModels(input: ModelListingInput): Promise<ModelCatalog | null> {
  const child = startProcess({
    command: input.binaryPath,
    args: CODEX_ARGS,
    env: input.env,
    cwd: homedir(),
  });
  if (child.kind === "start-failed") {
    return null;
  }
  const client = new CodexClient({
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    log: UNLOGGED,
    handlers: {
      onNotification: () => undefined,
      onRequest: () => undefined,
      onProtocolError: () => undefined,
      onStderr: () => undefined,
    },
  });
  const stop = AbortSignal.any([input.signal, AbortSignal.timeout(LISTING_TIMEOUT_MS)]);
  const listing = async (): Promise<ModelList> => {
    await client.request(CODEX_METHOD.initialize, initializeParams(), InitializeResult);
    client.notify(CODEX_METHOD.initialized);
    return client.request(CODEX_METHOD.modelList, {}, ModelListResult);
  };
  const gaveUp = once(stop, "abort").then(() => null);
  try {
    const list = await Promise.race([listing(), gaveUp]);
    return list === null ? null : catalogOf(list);
  } catch {
    return null;
  } finally {
    client.close();
    await child.stop();
  }
}
