import { parseJsonResult } from "@metabase/client/json";

import { ClaudeAuthStatus } from "../../../contracts/claude";
import type { ProviderAccount } from "../../../contracts/providers";
import { outputTail } from "../../process/spawn";
import type { ProviderProbe, ProviderProbeInput, ProviderProbeResult } from "../adapter";

import { CLAUDE_FALLBACK_MODELS } from "./catalog";
import { listClaudeModels } from "./models";

const BINARY_NAME = "claude";
const AUTH_STATUS_ARGS = ["auth", "status"] as const;
const AUTH_STATUS_OUTPUT_LIMIT_BYTES = 8 * 1024;

const AUTH_STATUS_TIMEOUT_MS = 15_000;

const SIGNED_OUT_MESSAGE = "Run `claude login`, then rescan.";
const UNREADABLE_STATUS_MESSAGE = "Couldn't read Claude Code's sign-in.";

function accountOf(status: ClaudeAuthStatus): ProviderAccount {
  const label = status.orgName ?? status.authMethod ?? "Signed in";
  return { label, email: status.email ?? null };
}

// `claude auth status` reads the local credential file and returns, so the check never starts a
// session or reaches a model.
async function probe(input: ProviderProbeInput): Promise<ProviderProbeResult> {
  const result = await input.run({
    command: input.binaryPath,
    args: AUTH_STATUS_ARGS,
    env: input.env,
    cwd: null,
    timeoutMs: AUTH_STATUS_TIMEOUT_MS,
    maxOutputBytes: AUTH_STATUS_OUTPUT_LIMIT_BYTES,
    signal: input.signal,
  });
  if (result.kind === "spawn-failed") {
    return {
      status: "error",
      account: null,
      message: `Claude Code could not be run: ${result.message}`,
    };
  }
  if (result.kind === "timed-out") {
    return {
      status: "error",
      account: null,
      message: `Claude Code did not report its sign-in within ${result.timeoutMs} ms.`,
    };
  }
  const status = parseJsonResult(result.stdout, ClaudeAuthStatus);
  if (!status.ok) {
    const tail = outputTail(result);
    return {
      status: "error",
      account: null,
      message: tail === null ? UNREADABLE_STATUS_MESSAGE : `${UNREADABLE_STATUS_MESSAGE} ${tail}`,
    };
  }
  if (!status.value.loggedIn) {
    return {
      status: "unauthenticated",
      account: null,
      message: SIGNED_OUT_MESSAGE,
    };
  }
  return { status: "ready", account: accountOf(status.value), message: null };
}

export const claudeProbe: ProviderProbe = {
  kind: "claude",
  binaryName: BINARY_NAME,
  fallbackModels: CLAUDE_FALLBACK_MODELS,
  listModels: listClaudeModels,
  probe,
};
