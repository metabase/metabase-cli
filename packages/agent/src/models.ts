import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

export const AGENT_MODEL_ENV = "AGENT_MODEL";
export const AGENT_MODELS_JSON_ENV = "AGENT_MODELS_JSON";

export const DEFAULT_MODEL = "anthropic/claude-sonnet-4-5";

// Nobody named a model: neither `--model` nor `AGENT_MODEL`. The model is then ours to choose, and
// a provider the operator has a key for beats one they don't.
const DEFAULT_SOURCE = "default";

export const SUPPORTED_PROVIDERS = {
  anthropic: "ANTHROPIC_API_KEY",
  moonshotai: "MOONSHOT_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  zai: "ZAI_API_KEY",
} as const;

export type SupportedProvider = keyof typeof SUPPORTED_PROVIDERS;

// The model each provider answers on when the operator named a provider but no model — pi's own
// defaults, so `/model` in the TUI and `AGENT_MODEL` agree about what "the openrouter model" is.
const DEFAULT_MODEL_PER_PROVIDER = {
  anthropic: "anthropic/claude-sonnet-4-5",
  moonshotai: "moonshotai/kimi-k2.6",
  openrouter: "openrouter/moonshotai/kimi-k2.6",
  zai: "zai/glm-5.1",
} as const satisfies Record<SupportedProvider, string>;

const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const satisfies readonly ThinkingLevel[];

export class ModelConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelConfigError";
  }
}

export interface AgentModel {
  // `provider/id` with the thinking suffix stripped; pi's resolver reads the provider off the prefix
  // and tolerates ids that themselves contain slashes (`openrouter/moonshotai/kimi-k2-thinking`).
  spec: string;
  provider: string;
  thinkingLevel: ThinkingLevel | null;
  // The key the environment carries, fed to `AuthStorage.setRuntimeApiKey` so it outranks a stored
  // one. `null` when pi resolves the key itself: from the keychain, from a models.json `apiKey`
  // reference, or — until `/login` runs — from nowhere.
  apiKey: string | null;
  modelsJsonPath: string | null;
}

export const DEFAULT_AGENT_MODEL: AgentModel = {
  spec: DEFAULT_MODEL,
  provider: "anthropic",
  thinkingLevel: null,
  apiKey: null,
  modelsJsonPath: null,
};

export interface ResolveAgentModelOptions {
  env: NodeJS.ProcessEnv;
  model?: string;
  modelsJson?: string;
  // Whether pi already holds a credential for the provider (the OS keychain, written by `/login`).
  // When it does, the environment need not carry a key and pi resolves one at request time.
  hasStoredCredential?: (provider: string) => boolean;
  // `chat` starts without any credential at all: pi reports the miss on the first prompt and points
  // at `/login`, which is a better first run than refusing to open the TUI.
  requireCredential?: boolean;
}

export function resolveAgentModel(options: ResolveAgentModelOptions): AgentModel {
  const source = pickSource(options);
  const { spec, thinkingLevel } = splitThinking(source.value);
  if (source.label === DEFAULT_SOURCE) {
    const credentialed = credentialedDefault(options);
    if (credentialed !== null) {
      return credentialed;
    }
  }
  const provider = readProvider(spec, source);
  const modelsJsonPath = trimmed(options.modelsJson) ?? trimmed(options.env[AGENT_MODELS_JSON_ENV]);

  if (!isSupportedProvider(provider)) {
    if (modelsJsonPath === null) {
      throw new ModelConfigError(unknownProviderMessage(provider, source));
    }
    return { spec, provider, thinkingLevel, apiKey: null, modelsJsonPath };
  }

  const keyEnv = SUPPORTED_PROVIDERS[provider];
  const apiKey = trimmed(options.env[keyEnv]);
  if (apiKey !== null) {
    return { spec, provider, thinkingLevel, apiKey, modelsJsonPath };
  }
  const stored = options.hasStoredCredential?.(provider) ?? false;
  if (stored || options.requireCredential === false) {
    return { spec, provider, thinkingLevel, apiKey: null, modelsJsonPath };
  }
  throw new ModelConfigError(
    `Missing ${keyEnv} — the "${provider}" provider needs it to run ${spec}. ` +
      "Set it, or run `mb-agent chat` and `/login` to store a key in the OS keychain.",
  );
}

// Nobody named a model, so run the one there is a key for. Anthropic first — it is the default when
// every provider is credentialed — then the declaration order of the table. Starting on a provider
// with no credential would open the TUI on a model that errors on the first prompt, and would leave
// pi's post-`/login` model selection inert: it only picks a model for a session that has none.
function credentialedDefault(options: ResolveAgentModelOptions): AgentModel | null {
  for (const provider of providerNames()) {
    const envKey = trimmed(options.env[SUPPORTED_PROVIDERS[provider]]);
    const stored = options.hasStoredCredential?.(provider) ?? false;
    if (envKey === null && !stored) {
      continue;
    }
    const { spec, thinkingLevel } = splitThinking(DEFAULT_MODEL_PER_PROVIDER[provider]);
    return {
      spec,
      provider,
      thinkingLevel,
      apiKey: envKey,
      modelsJsonPath: trimmed(options.modelsJson) ?? trimmed(options.env[AGENT_MODELS_JSON_ENV]),
    };
  }
  return null;
}

function providerNames(): SupportedProvider[] {
  return Object.keys(SUPPORTED_PROVIDERS).filter(isSupportedProvider);
}

// Whether the environment configures any model at all. Callers that must not run without one (the
// smokes) use it to skip, so a *misconfigured* model still fails loudly instead of skipping.
export function hasProviderKey(env: NodeJS.ProcessEnv): boolean {
  const keyed = Object.values(SUPPORTED_PROVIDERS).some((keyEnv) => trimmed(env[keyEnv]) !== null);
  return keyed || trimmed(env[AGENT_MODELS_JSON_ENV]) !== null;
}

interface ModelSource {
  label: string;
  value: string;
}

function pickSource(options: ResolveAgentModelOptions): ModelSource {
  const flag = trimmed(options.model);
  if (flag !== null) {
    return { label: "--model", value: flag };
  }
  const env = trimmed(options.env[AGENT_MODEL_ENV]);
  if (env !== null) {
    return { label: AGENT_MODEL_ENV, value: env };
  }
  return { label: DEFAULT_SOURCE, value: DEFAULT_MODEL };
}

interface ParsedSpec {
  spec: string;
  thinkingLevel: ThinkingLevel | null;
}

// A trailing `:level` is a thinking level; every other colon belongs to the model id
// (`ollama/llama3.1:8b`, `openrouter/openai/gpt-4o:extended`).
function splitThinking(value: string): ParsedSpec {
  const colon = value.lastIndexOf(":");
  if (colon === -1) {
    return { spec: value, thinkingLevel: null };
  }
  const suffix = value.slice(colon + 1);
  if (!isThinkingLevel(suffix)) {
    return { spec: value, thinkingLevel: null };
  }
  return { spec: value.slice(0, colon), thinkingLevel: suffix };
}

function readProvider(spec: string, source: ModelSource): string {
  const slash = spec.indexOf("/");
  const provider = slash === -1 ? "" : spec.slice(0, slash);
  const id = slash === -1 ? "" : spec.slice(slash + 1);
  if (provider === "" || id === "") {
    throw new ModelConfigError(
      `Invalid model "${source.value}" (${source.label}). Expected provider/model[:thinking], e.g. "${DEFAULT_MODEL}".`,
    );
  }
  return provider;
}

function unknownProviderMessage(provider: string, source: ModelSource): string {
  const supported = Object.keys(SUPPORTED_PROVIDERS).join(", ");
  return (
    `Unknown provider "${provider}" (${source.label}). Supported providers: ${supported}. ` +
    `Any other OpenAI-compatible endpoint goes in a models.json — point ${AGENT_MODELS_JSON_ENV} or --models-json at it.`
  );
}

function isSupportedProvider(provider: string): provider is SupportedProvider {
  return Object.hasOwn(SUPPORTED_PROVIDERS, provider);
}

function isThinkingLevel(value: string): value is ThinkingLevel {
  return THINKING_LEVELS.some((level) => level === value);
}

function trimmed(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const text = value.trim();
  return text === "" ? null : text;
}
