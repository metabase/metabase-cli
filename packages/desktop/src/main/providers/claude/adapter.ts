import type { ProviderAdapter } from "../adapter";

import { claudeProbe } from "./probe";
import { rewindClaudeSession } from "./rewind";
import { startClaudeSession } from "./session";

export const claudeAdapter: ProviderAdapter = {
  ...claudeProbe,
  start: startClaudeSession,
  rewind: rewindClaudeSession,
};
