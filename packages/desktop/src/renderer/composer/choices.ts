import { assertNever } from "../../contracts/assert-never";
import type { PermissionMode } from "../../contracts/events";
import type { ProviderHealth, ProviderModel } from "../../contracts/providers";
import { PROVIDER_LABELS } from "../../contracts/providers";
import type { CreateSessionRequest, Session, WorkspaceRequest } from "../../contracts/session";
import type { AgentDefaults } from "../../contracts/settings";

import type { NewSessionDraft, WorkspaceMode } from "./draft";
import { PERMISSION_LABELS, PERMISSION_MODES, WORKSPACE_LABELS, WORKSPACE_MODES } from "./draft";

export type ChoiceKey = "workspace" | "provider" | "model" | "permission";

const CHOICE_TITLES: Readonly<Record<ChoiceKey, string>> = {
  workspace: "Workspace",
  provider: "Agent",
  model: "Model",
  permission: "Permissions",
};

export interface ChoiceOption {
  readonly value: string;
  readonly label: string;
}

// One chip in the composer's row: `title` heads its menu, `label` is the chip's face.
export interface Choice {
  readonly key: ChoiceKey;
  readonly title: string;
  readonly value: string;
  readonly label: string;
  readonly options: readonly ChoiceOption[];
}

// What a new session will start on, every field concrete.
export interface NewSessionSetup {
  readonly provider: ProviderHealth;
  readonly model: ProviderModel;
  readonly workspace: WorkspaceMode;
  readonly permissionMode: PermissionMode;
}

export const LABEL_SEPARATOR = " · ";

// A running session reports the model an alias resolved to, so either id names the entry.
export function modelOf(health: ProviderHealth, id: string): ProviderModel | null {
  return health.models.find((entry) => entry.id === id || entry.resolvedId === id) ?? null;
}

// The model Settings › Agents names, or the agent's own default when the agent no longer offers it.
export function startingModel(
  health: ProviderHealth,
  defaults: AgentDefaults,
): ProviderModel | null {
  return (
    modelOf(health, defaults.models[health.kind]) ??
    modelOf(health, health.defaultModel) ??
    health.models[0] ??
    null
  );
}

export function newSessionSetup(
  ready: readonly ProviderHealth[],
  defaults: AgentDefaults,
  draft: NewSessionDraft,
): NewSessionSetup | null {
  const provider = ready.find((health) => health.kind === draft.provider) ?? ready[0];
  if (provider === undefined) {
    return null;
  }
  const picked = draft.model === null ? null : modelOf(provider, draft.model);
  const model = picked ?? startingModel(provider, defaults);
  if (model === null) {
    return null;
  }
  return {
    provider,
    model,
    workspace: draft.workspace,
    permissionMode: draft.permissionMode ?? defaults.permissionMode,
  };
}

function modelOptions(health: ProviderHealth): readonly ChoiceOption[] {
  return health.models.map((entry) => ({ value: entry.id, label: entry.label }));
}

const WORKSPACE_OPTIONS: readonly ChoiceOption[] = WORKSPACE_MODES.map((mode) => ({
  value: mode,
  label: WORKSPACE_LABELS[mode],
}));

export const PERMISSION_OPTIONS: readonly ChoiceOption[] = PERMISSION_MODES.map((mode) => ({
  value: mode,
  label: PERMISSION_LABELS[mode],
}));

// The agent is a chip only when there is another to pick; alone, it heads the model's menu.
export function newSessionChoices(
  ready: readonly ProviderHealth[],
  setup: NewSessionSetup,
): readonly Choice[] {
  const lone = ready.length === 1;
  const agent: Choice = {
    key: "provider",
    title: CHOICE_TITLES.provider,
    value: setup.provider.kind,
    label: PROVIDER_LABELS[setup.provider.kind],
    options: ready.map((health) => ({ value: health.kind, label: PROVIDER_LABELS[health.kind] })),
  };
  const choices: readonly Choice[] = [
    {
      key: "workspace",
      title: CHOICE_TITLES.workspace,
      value: setup.workspace,
      label: WORKSPACE_LABELS[setup.workspace],
      options: WORKSPACE_OPTIONS,
    },
    agent,
    {
      key: "model",
      title: lone ? agent.label : CHOICE_TITLES.model,
      value: setup.model.id,
      label: setup.model.label,
      options: modelOptions(setup.provider),
    },
    {
      key: "permission",
      title: CHOICE_TITLES.permission,
      value: setup.permissionMode,
      label: PERMISSION_LABELS[setup.permissionMode],
      options: PERMISSION_OPTIONS,
    },
  ];
  return lone ? choices.filter((entry) => entry.key !== "provider") : choices;
}

// A value the menu did not offer leaves the draft as it was.
export function choose(
  setup: NewSessionSetup,
  ready: readonly ProviderHealth[],
  draft: NewSessionDraft,
  key: ChoiceKey,
  value: string,
): NewSessionDraft {
  switch (key) {
    case "provider": {
      const health = ready.find((entry) => entry.kind === value);
      return health === undefined ? draft : { ...draft, provider: health.kind, model: null };
    }
    case "model": {
      const model = modelOf(setup.provider, value);
      return model === null ? draft : { ...draft, provider: setup.provider.kind, model: model.id };
    }
    case "workspace": {
      const workspace = WORKSPACE_MODES.find((mode) => mode === value);
      return workspace === undefined ? draft : { ...draft, workspace };
    }
    case "permission": {
      const permissionMode = PERMISSION_MODES.find((mode) => mode === value);
      return permissionMode === undefined ? draft : { ...draft, permissionMode };
    }
    default: {
      return assertNever(key);
    }
  }
}

function workspaceOf(mode: WorkspaceMode): WorkspaceRequest {
  return mode === "in-place" ? { kind: "in-place" } : { kind: "worktree", base: null };
}

export function startRequest(setup: NewSessionSetup, text: string): CreateSessionRequest | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return {
    provider: setup.provider.kind,
    model: setup.model.id,
    permissionMode: setup.permissionMode,
    workspace: workspaceOf(setup.workspace),
    text: trimmed,
    attachments: [],
  };
}

// What a running session runs on, by the names the menus use. A model the agent no longer lists
// goes unnamed rather than shown as a raw id.
export function sessionFacts(
  session: Session,
  providers: readonly ProviderHealth[],
): readonly string[] {
  const health = providers.find((entry) => entry.kind === session.provider);
  const model =
    health === undefined || session.model === null ? null : modelOf(health, session.model);
  return [
    PROVIDER_LABELS[session.provider],
    ...(model === null ? [] : [model.label]),
    PERMISSION_LABELS[session.permissionMode],
  ];
}
