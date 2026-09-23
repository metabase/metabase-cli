import type { ModelCatalog } from "../adapter";

// The models `codex debug models` lists for `--model`, for when the agent cannot list its own.
export const CODEX_FALLBACK_MODELS: ModelCatalog = {
  models: [
    { id: "gpt-6-astra", label: "GPT-6-Astra", resolvedId: null },
    { id: "gpt-5.6-sol", label: "GPT-5.6-Sol", resolvedId: null },
    { id: "gpt-5.6-terra", label: "GPT-5.6-Terra", resolvedId: null },
    { id: "gpt-5.6-luna", label: "GPT-5.6-Luna", resolvedId: null },
  ],
  defaultModel: "gpt-6-astra",
};
