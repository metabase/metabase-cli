import type { ProviderKind } from "../../contracts/providers";

import type { ModelCatalog } from "./adapter";
import { CLAUDE_FALLBACK_MODELS } from "./claude/catalog";
import { CODEX_FALLBACK_MODELS } from "./codex/catalog";

export const FALLBACK_MODELS: Readonly<Record<ProviderKind, ModelCatalog>> = {
  claude: CLAUDE_FALLBACK_MODELS,
  codex: CODEX_FALLBACK_MODELS,
};
