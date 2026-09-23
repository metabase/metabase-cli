import type { ProviderAdapter, RewindOutcome } from "../adapter";

import { codexProbe } from "./probe";
import { startCodexSession } from "./session";

// `thread/rollback` exists, but what it drops cannot be checked against a live thread on a machine
// where Codex is signed out, so the app replays the transcript into a new conversation instead.
const ROLLBACK_UNPROVEN = "Codex sessions can't go back to an earlier prompt.";

export const codexAdapter: ProviderAdapter = {
  ...codexProbe,
  start: startCodexSession,
  rewind: async (): Promise<RewindOutcome> => ({ kind: "unsupported", reason: ROLLBACK_UNPROVEN }),
};
