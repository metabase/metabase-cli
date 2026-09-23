import type { ProviderAccount } from "../../../contracts/providers";
import { outputTail } from "../../process/spawn";
import type { ProviderProbe, ProviderProbeInput, ProviderProbeResult } from "../adapter";

import { CODEX_FALLBACK_MODELS } from "./catalog";
import { listCodexModels } from "./models";

const BINARY_NAME = "codex";
const LOGIN_STATUS_ARGS = ["login", "status"] as const;
const LOGIN_STATUS_OUTPUT_LIMIT_BYTES = 8 * 1024;

const LOGIN_STATUS_TIMEOUT_MS = 15_000;

const SIGNED_OUT_OUTPUT = "Not logged in";
const SIGNED_OUT_MESSAGE = "Run `codex login`, then rescan.";
const UNREADABLE_STATUS_MESSAGE = "Codex did not report who is signed in.";

const EMAIL_PATTERN = /\S+@\S+/;

function firstLine(text: string): string | null {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return null;
}

function accountOf(line: string): ProviderAccount {
  const email = EMAIL_PATTERN.exec(line);
  return { label: line, email: email === null ? null : email[0] };
}

async function probe(input: ProviderProbeInput): Promise<ProviderProbeResult> {
  const result = await input.run({
    command: input.binaryPath,
    args: LOGIN_STATUS_ARGS,
    env: input.env,
    cwd: null,
    timeoutMs: LOGIN_STATUS_TIMEOUT_MS,
    maxOutputBytes: LOGIN_STATUS_OUTPUT_LIMIT_BYTES,
    signal: input.signal,
  });
  if (result.kind === "spawn-failed") {
    return {
      status: "error",
      account: null,
      message: `Codex could not be run: ${result.message}`,
    };
  }
  if (result.kind === "timed-out") {
    return {
      status: "error",
      account: null,
      message: `Codex did not report its sign-in within ${result.timeoutMs} ms.`,
    };
  }
  const tail = outputTail(result);
  if (tail !== null && tail.includes(SIGNED_OUT_OUTPUT)) {
    return {
      status: "unauthenticated",
      account: null,
      message: SIGNED_OUT_MESSAGE,
    };
  }
  if (result.code !== 0) {
    return {
      status: "error",
      account: null,
      message: tail === null ? UNREADABLE_STATUS_MESSAGE : `${UNREADABLE_STATUS_MESSAGE} ${tail}`,
    };
  }
  const line = firstLine(result.stdout);
  if (line === null) {
    return {
      status: "error",
      account: null,
      message: UNREADABLE_STATUS_MESSAGE,
    };
  }
  return { status: "ready", account: accountOf(line), message: null };
}

export const codexProbe: ProviderProbe = {
  kind: "codex",
  binaryName: BINARY_NAME,
  fallbackModels: CODEX_FALLBACK_MODELS,
  listModels: listCodexModels,
  probe,
};
