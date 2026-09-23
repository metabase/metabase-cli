import { describe, expect, it } from "vitest";

import type { ProviderHealth, ProviderKind, ProviderModel } from "../../contracts/providers";
import type { AgentDefaults } from "../../contracts/settings";

import { choose, newSessionChoices, newSessionSetup, type NewSessionSetup } from "./choices";
import { EMPTY_DRAFT, type NewSessionDraft } from "./draft";

const CLAUDE_MODELS: readonly ProviderModel[] = [
  { id: "opus[1m]", label: "Opus (1M context)", resolvedId: "claude-opus-5-5[1m]" },
  { id: "sonnet", label: "Sonnet", resolvedId: "claude-sonnet-5" },
];

const CODEX_MODELS: readonly ProviderModel[] = [
  { id: "gpt-6-astra", label: "GPT-6-Astra", resolvedId: null },
];

function ready(kind: ProviderKind, models: readonly ProviderModel[]): ProviderHealth {
  const first = models[0];
  if (first === undefined) {
    throw new Error("a ready agent lists at least one model");
  }
  return {
    kind,
    installed: true,
    path: `/usr/local/bin/${kind}`,
    version: "1.0.0",
    status: "ready",
    account: null,
    models: [...models],
    defaultModel: first.id,
    message: null,
    checkedAt: "2026-09-23T07:00:00.000Z",
  };
}

const CLAUDE = ready("claude", CLAUDE_MODELS);
const CODEX = ready("codex", CODEX_MODELS);

const DEFAULTS: AgentDefaults = {
  models: { claude: "sonnet", codex: "gpt-6-astra" },
  permissionMode: "ask",
};

const DRAFT: NewSessionDraft = { ...EMPTY_DRAFT, text: "Clean the orders transform" };

function setupOf(providers: readonly ProviderHealth[], draft: NewSessionDraft): NewSessionSetup {
  const setup = newSessionSetup(providers, DEFAULTS, draft);
  if (setup === null) {
    throw new Error("expected a ready agent");
  }
  return setup;
}

describe("what a new session starts on", () => {
  it("starts on the model and permissions Settings names", () => {
    const setup = setupOf([CLAUDE], DRAFT);
    expect([setup.model.id, setup.permissionMode]).toEqual(["sonnet", "ask"]);
  });

  it("falls back to the agent's own default when Settings names a model it no longer lists", () => {
    const stale: AgentDefaults = { ...DEFAULTS, models: { ...DEFAULTS.models, claude: "opus" } };
    expect(newSessionSetup([CLAUDE], stale, DRAFT)?.model.id).toBe("opus[1m]");
  });

  it("has nothing to start on when no agent is ready", () => {
    expect(newSessionSetup([], DEFAULTS, DRAFT)).toBeNull();
  });
});

describe("the chips the composer shows", () => {
  it("names a lone agent in the model's menu, not on a chip", () => {
    const choices = newSessionChoices([CLAUDE], setupOf([CLAUDE], DRAFT));
    expect(choices.map((entry) => [entry.key, entry.title, entry.label])).toEqual([
      ["workspace", "Workspace", "New worktree"],
      ["model", "Claude Code", "Sonnet"],
      ["permission", "Permissions", "Ask first"],
    ]);
  });

  it("gives the agent its own chip once there is another to pick", () => {
    const choices = newSessionChoices([CLAUDE, CODEX], setupOf([CLAUDE, CODEX], DRAFT));
    expect(choices.map((entry) => entry.key)).toEqual([
      "workspace",
      "provider",
      "model",
      "permission",
    ]);
  });
});

describe("choosing from a chip's menu", () => {
  it("resets the model when the agent changes", () => {
    const draft = { ...DRAFT, model: "sonnet" };
    const setup = setupOf([CLAUDE, CODEX], draft);
    expect(choose(setup, [CLAUDE, CODEX], draft, "provider", "codex")).toEqual({
      ...draft,
      provider: "codex",
      model: null,
    });
  });

  it("leaves the draft as it was for a model the agent does not list", () => {
    const setup = setupOf([CLAUDE], DRAFT);
    expect(choose(setup, [CLAUDE], DRAFT, "model", "gpt-6-astra")).toBe(DRAFT);
  });
});
