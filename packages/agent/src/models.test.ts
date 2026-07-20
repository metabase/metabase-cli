import { expect, test } from "vitest";
import {
  type AgentModel,
  DEFAULT_MODEL,
  ModelConfigError,
  resolveAgentModel,
  SUPPORTED_PROVIDERS,
  type SupportedProvider,
} from "./models";

interface ProviderCase {
  provider: SupportedProvider;
  spec: string;
}

const PROVIDER_CASES: readonly ProviderCase[] = [
  { provider: "anthropic", spec: "anthropic/claude-opus-4-8" },
  { provider: "moonshotai", spec: "moonshotai/kimi-k2-thinking" },
  { provider: "openrouter", spec: "openrouter/moonshotai/kimi-k2-thinking" },
  { provider: "zai", spec: "zai/glm-5.1" },
];

test("defaults to Anthropic and reads the key from ANTHROPIC_API_KEY", () => {
  const model = resolveAgentModel({ env: { ANTHROPIC_API_KEY: "sk-ant-test" } });

  const expected: AgentModel = {
    spec: DEFAULT_MODEL,
    provider: "anthropic",
    thinkingLevel: null,
    apiKey: "sk-ant-test",
    modelsJsonPath: null,
  };
  expect(model).toEqual(expected);
});

test("resolves every supported provider from AGENT_MODEL plus its own key env var", () => {
  expect(PROVIDER_CASES.map((entry) => entry.provider)).toEqual(Object.keys(SUPPORTED_PROVIDERS));

  const resolved = PROVIDER_CASES.map(({ provider, spec }) =>
    resolveAgentModel({
      env: { AGENT_MODEL: spec, [SUPPORTED_PROVIDERS[provider]]: `key-for-${provider}` },
    }),
  );

  const expected: AgentModel[] = [
    {
      spec: "anthropic/claude-opus-4-8",
      provider: "anthropic",
      thinkingLevel: null,
      apiKey: "key-for-anthropic",
      modelsJsonPath: null,
    },
    {
      spec: "moonshotai/kimi-k2-thinking",
      provider: "moonshotai",
      thinkingLevel: null,
      apiKey: "key-for-moonshotai",
      modelsJsonPath: null,
    },
    {
      spec: "openrouter/moonshotai/kimi-k2-thinking",
      provider: "openrouter",
      thinkingLevel: null,
      apiKey: "key-for-openrouter",
      modelsJsonPath: null,
    },
    {
      spec: "zai/glm-5.1",
      provider: "zai",
      thinkingLevel: null,
      apiKey: "key-for-zai",
      modelsJsonPath: null,
    },
  ];
  expect(resolved).toEqual(expected);
});

test("--model overrides AGENT_MODEL", () => {
  const model = resolveAgentModel({
    env: { AGENT_MODEL: "anthropic/claude-opus-4-8", ZAI_API_KEY: "zai-key" },
    model: "zai/glm-5.1",
  });

  const expected: AgentModel = {
    spec: "zai/glm-5.1",
    provider: "zai",
    thinkingLevel: null,
    apiKey: "zai-key",
    modelsJsonPath: null,
  };
  expect(model).toEqual(expected);
});

test("strips a trailing thinking level from the spec", () => {
  const model = resolveAgentModel({
    env: { AGENT_MODEL: "zai/glm-5.1:high", ZAI_API_KEY: "zai-key" },
  });

  const expected: AgentModel = {
    spec: "zai/glm-5.1",
    provider: "zai",
    thinkingLevel: "high",
    apiKey: "zai-key",
    modelsJsonPath: null,
  };
  expect(model).toEqual(expected);
});

test("keeps a colon that is part of the model id", () => {
  const model = resolveAgentModel({
    env: { AGENT_MODEL: "openrouter/openai/gpt-4o:extended", OPENROUTER_API_KEY: "or-key" },
  });

  const expected: AgentModel = {
    spec: "openrouter/openai/gpt-4o:extended",
    provider: "openrouter",
    thinkingLevel: null,
    apiKey: "or-key",
    modelsJsonPath: null,
  };
  expect(model).toEqual(expected);
});

test("delegates key resolution to pi for a models.json provider", () => {
  const model = resolveAgentModel({
    env: { AGENT_MODEL: "vllm/qwen3-coder", AGENT_MODELS_JSON: "/etc/mb-agent/models.json" },
  });

  const expected: AgentModel = {
    spec: "vllm/qwen3-coder",
    provider: "vllm",
    thinkingLevel: null,
    apiKey: null,
    modelsJsonPath: "/etc/mb-agent/models.json",
  };
  expect(model).toEqual(expected);
});

test("rejects a model with no provider prefix", () => {
  const resolve = (): AgentModel =>
    resolveAgentModel({ env: { AGENT_MODEL: "claude-sonnet-4-5", ANTHROPIC_API_KEY: "k" } });

  expect(resolve).toThrowError(ModelConfigError);
  expect(resolve).toThrowError(
    'Invalid model "claude-sonnet-4-5" (AGENT_MODEL). Expected provider/model[:thinking], e.g. "anthropic/claude-sonnet-4-5".',
  );
});

test("rejects a provider with no model id, naming --model when the flag supplied it", () => {
  const resolve = (): AgentModel => resolveAgentModel({ env: {}, model: "zai/" });

  expect(resolve).toThrowError(ModelConfigError);
  expect(resolve).toThrowError(
    'Invalid model "zai/" (--model). Expected provider/model[:thinking], e.g. "anthropic/claude-sonnet-4-5".',
  );
});

test("rejects an unsupported provider with no models.json to define it", () => {
  const resolve = (): AgentModel => resolveAgentModel({ env: { AGENT_MODEL: "vllm/qwen3-coder" } });

  expect(resolve).toThrowError(ModelConfigError);
  expect(resolve).toThrowError(
    'Unknown provider "vllm" (AGENT_MODEL). Supported providers: anthropic, moonshotai, openrouter, zai. ' +
      "Any other OpenAI-compatible endpoint goes in a models.json — point AGENT_MODELS_JSON or --models-json at it.",
  );
});

test("names the missing key env var of the provider the model selected", () => {
  const resolve = (): AgentModel =>
    resolveAgentModel({ env: { AGENT_MODEL: "moonshotai/kimi-k2-thinking:high" } });

  expect(resolve).toThrowError(ModelConfigError);
  expect(resolve).toThrowError(
    'Missing MOONSHOT_API_KEY — the "moonshotai" provider needs it to run moonshotai/kimi-k2-thinking.',
  );
});

test("treats a blank key as missing", () => {
  const resolve = (): AgentModel =>
    resolveAgentModel({ env: { AGENT_MODEL: "zai/glm-5.1", ZAI_API_KEY: "   " } });

  expect(resolve).toThrowError(
    'Missing ZAI_API_KEY — the "zai" provider needs it to run zai/glm-5.1.',
  );
});

test("leaves the key to pi when the provider's credential is already stored", () => {
  const model = resolveAgentModel({
    env: { AGENT_MODEL: "zai/glm-5.1" },
    hasStoredCredential: (provider) => provider === "zai",
  });

  expect(model).toEqual({
    spec: "zai/glm-5.1",
    provider: "zai",
    thinkingLevel: null,
    apiKey: null,
    modelsJsonPath: null,
  });
});

test("prefers the environment's key over a stored one", () => {
  const model = resolveAgentModel({
    env: { AGENT_MODEL: "zai/glm-5.1", ZAI_API_KEY: "zai-from-env" },
    hasStoredCredential: () => true,
  });

  expect(model).toEqual({
    spec: "zai/glm-5.1",
    provider: "zai",
    thinkingLevel: null,
    apiKey: "zai-from-env",
    modelsJsonPath: null,
  });
});

test("resolves without any credential when one is not required", () => {
  const model = resolveAgentModel({
    env: { AGENT_MODEL: "anthropic/claude-sonnet-4-5:high" },
    requireCredential: false,
  });

  expect(model).toEqual({
    spec: "anthropic/claude-sonnet-4-5",
    provider: "anthropic",
    thinkingLevel: "high",
    apiKey: null,
    modelsJsonPath: null,
  });
});

test("runs the model of the provider there is a key for when nobody named one", () => {
  const model = resolveAgentModel({
    env: {},
    hasStoredCredential: (provider) => provider === "openrouter",
  });

  expect(model).toEqual({
    spec: "openrouter/moonshotai/kimi-k2.6",
    provider: "openrouter",
    thinkingLevel: null,
    apiKey: null,
    modelsJsonPath: null,
  });
});

test("prefers anthropic when several providers are credentialed", () => {
  const model = resolveAgentModel({
    env: { ANTHROPIC_API_KEY: "sk-ant", OPENROUTER_API_KEY: "sk-or" },
  });

  expect(model).toEqual({
    spec: DEFAULT_MODEL,
    provider: "anthropic",
    thinkingLevel: null,
    apiKey: "sk-ant",
    modelsJsonPath: null,
  });
});

test("an explicitly named model outranks whichever provider holds a key", () => {
  const model = resolveAgentModel({
    env: { AGENT_MODEL: "zai/glm-5.1" },
    hasStoredCredential: (provider) => provider === "openrouter",
    requireCredential: false,
  });

  expect(model).toEqual({
    spec: "zai/glm-5.1",
    provider: "zai",
    thinkingLevel: null,
    apiKey: null,
    modelsJsonPath: null,
  });
});
