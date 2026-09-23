import type { ModelCatalog } from "../adapter";

// The rows the CLI's handshake lists after `newestPerTier`, for when the agent cannot list its own.
export const CLAUDE_FALLBACK_MODELS: ModelCatalog = {
  models: [
    { id: "opus", label: "Opus 5.5", resolvedId: "claude-opus-5-5" },
    { id: "claude-fable-5-1", label: "Fable 5.1", resolvedId: "claude-fable-5-1" },
    { id: "sonnet", label: "Sonnet 5", resolvedId: "claude-sonnet-5" },
    { id: "haiku", label: "Haiku 4.5", resolvedId: "claude-haiku-4-5-20251001" },
  ],
  defaultModel: "opus",
};
