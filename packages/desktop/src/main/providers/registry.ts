import type { ProviderKind } from "../../contracts/providers";

import type { ProviderAdapter } from "./adapter";
import { claudeAdapter } from "./claude/adapter";
import { codexAdapter } from "./codex/adapter";

export const PROVIDER_ADAPTERS: Readonly<Record<ProviderKind, ProviderAdapter>> = {
  claude: claudeAdapter,
  codex: codexAdapter,
};
