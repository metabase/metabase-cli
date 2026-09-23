import type { ConnectionState } from "../contracts/connection";
import type { ProviderHealth } from "../contracts/providers";
import type { RepositorySnapshot } from "../contracts/settings";

import { assertNever } from "../contracts/assert-never";
import type { SettingsSection } from "./settings-sections";

const STEP_LABELS = {
  connect: "Connect to Metabase",
  repository: "Pick a repository",
  agent: "Install an agent",
} as const;

type OnboardingStepId = keyof typeof STEP_LABELS;

const STEP_SECTIONS: Readonly<Record<OnboardingStepId, SettingsSection>> = {
  connect: "metabase",
  repository: "repository",
  agent: "agents",
};

export interface OnboardingStep {
  readonly id: OnboardingStepId;
  readonly label: string;
  readonly done: boolean;
  readonly section: SettingsSection;
}

export interface OnboardingInput {
  readonly connection: ConnectionState;
  readonly repository: RepositorySnapshot | null;
  readonly providers: readonly ProviderHealth[];
}

export function onboardingSteps(input: OnboardingInput): readonly OnboardingStep[] {
  return [
    step("connect", holdsCredential(input.connection)),
    step("repository", input.repository !== null),
    step("agent", input.providers.some(canTakeSession)),
  ];
}

export function onboardingComplete(steps: readonly OnboardingStep[]): boolean {
  return steps.every((entry) => entry.done);
}

// A session needs a checkout and an agent. Metabase is what `mb` talks to inside the session, so a
// disconnected app can still run one; the composer says what that session will be missing.
export function canStartSession(input: OnboardingInput): boolean {
  return input.repository !== null && input.providers.some(canTakeSession);
}

function step(id: OnboardingStepId, done: boolean): OnboardingStep {
  return { id, label: STEP_LABELS[id], done, section: STEP_SECTIONS[id] };
}

function holdsCredential(connection: ConnectionState): boolean {
  switch (connection.kind) {
    case "connected":
    case "stale": {
      return true;
    }
    case "disconnected":
    case "signed-out": {
      return false;
    }
    default: {
      return assertNever(connection);
    }
  }
}

function canTakeSession(provider: ProviderHealth): boolean {
  return provider.status === "ready";
}
