import { describe, expect, it } from "vitest";

import type { ConnectionState } from "../contracts/connection";
import type { ProviderHealth, ProviderStatus } from "../contracts/providers";
import type { ConnectedUser, RepositorySnapshot, ServerSummary } from "../contracts/settings";

import { onboardingComplete, onboardingSteps } from "./onboarding";

const MOMENT = "2026-01-08T09:30:00.000Z";
const SITE_URL = "https://metabase.example.com";

const SERVER: ServerSummary = {
  version: "v1.65.0",
  edition: "ee",
  features: { remoteSync: false, transforms: true, transformTests: false },
};

const USER: ConnectedUser = {
  id: 7,
  email: "ada@example.com",
  name: "Ada Lovelace",
  isSuperuser: true,
};

const DISCONNECTED: ConnectionState = { kind: "disconnected" };

const CONNECTED: ConnectionState = {
  kind: "connected",
  url: SITE_URL,
  user: USER,
  server: SERVER,
  connectedAt: MOMENT,
};

const SIGNED_OUT: ConnectionState = {
  kind: "signed-out",
  url: SITE_URL,
  user: USER,
  reason: "The stored credential expired.",
};

const STALE: ConnectionState = {
  kind: "stale",
  url: SITE_URL,
  user: USER,
  server: SERVER,
  lastProbeAt: MOMENT,
  reason: "Connection refused.",
};

const REPOSITORY: RepositorySnapshot = {
  path: "/home/ada/analytics",
  remote: "git@github.com:ada/analytics.git",
  defaultBranch: "main",
  layout: "representation",
};

const NO_PROVIDERS: readonly ProviderHealth[] = [];

function agent(status: ProviderStatus): ProviderHealth {
  return {
    kind: "claude",
    installed: status !== "missing",
    path: "/usr/local/bin/agent",
    version: "2.1.0",
    status,
    account: null,
    models: [{ id: "opus", label: "Opus", resolvedId: null }],
    defaultModel: "opus",
    message: null,
    checkedAt: MOMENT,
  };
}

const CONNECT_DONE = {
  id: "connect",
  label: "Connect to Metabase",
  done: true,
  section: "metabase",
};
const CONNECT_TODO = { ...CONNECT_DONE, done: false };

const REPOSITORY_DONE = {
  id: "repository",
  label: "Pick a repository",
  done: true,
  section: "repository",
};
const REPOSITORY_TODO = { ...REPOSITORY_DONE, done: false };

const AGENT_DONE = { id: "agent", label: "Install an agent", done: true, section: "agents" };
const AGENT_TODO = { ...AGENT_DONE, done: false };

describe("onboardingSteps", () => {
  it("leaves every step undone on a fresh install", () => {
    const steps = onboardingSteps({
      connection: DISCONNECTED,
      repository: null,
      providers: NO_PROVIDERS,
    });

    expect(steps).toEqual([CONNECT_TODO, REPOSITORY_TODO, AGENT_TODO]);
  });

  it("marks the Metabase step done for a connected server", () => {
    const steps = onboardingSteps({
      connection: CONNECTED,
      repository: null,
      providers: NO_PROVIDERS,
    });

    expect(steps).toEqual([CONNECT_DONE, REPOSITORY_TODO, AGENT_TODO]);
  });

  it("marks the Metabase step done for a stale connection, which keeps its credential", () => {
    const steps = onboardingSteps({
      connection: STALE,
      repository: null,
      providers: NO_PROVIDERS,
    });

    expect(steps).toEqual([CONNECT_DONE, REPOSITORY_TODO, AGENT_TODO]);
  });

  it("leaves the Metabase step undone for a signed-out connection", () => {
    const steps = onboardingSteps({
      connection: SIGNED_OUT,
      repository: null,
      providers: NO_PROVIDERS,
    });

    expect(steps).toEqual([CONNECT_TODO, REPOSITORY_TODO, AGENT_TODO]);
  });

  it("marks the repository step done once a repository is chosen", () => {
    const steps = onboardingSteps({
      connection: DISCONNECTED,
      repository: REPOSITORY,
      providers: NO_PROVIDERS,
    });

    expect(steps).toEqual([CONNECT_TODO, REPOSITORY_DONE, AGENT_TODO]);
  });

  it("marks the agent step done when one provider can take a session", () => {
    const steps = onboardingSteps({
      connection: DISCONNECTED,
      repository: null,
      providers: [agent("error"), agent("ready")],
    });

    expect(steps).toEqual([CONNECT_TODO, REPOSITORY_TODO, AGENT_DONE]);
  });

  it("leaves the agent step undone while every provider is installed but unauthenticated", () => {
    const steps = onboardingSteps({
      connection: DISCONNECTED,
      repository: null,
      providers: [agent("unauthenticated"), agent("missing")],
    });

    expect(steps).toEqual([CONNECT_TODO, REPOSITORY_TODO, AGENT_TODO]);
  });
});

describe("onboardingComplete", () => {
  it("holds once every step is done", () => {
    const steps = onboardingSteps({
      connection: CONNECTED,
      repository: REPOSITORY,
      providers: [agent("ready")],
    });

    expect(onboardingComplete(steps)).toBe(true);
  });

  it("fails while one step is undone", () => {
    const steps = onboardingSteps({
      connection: CONNECTED,
      repository: REPOSITORY,
      providers: [agent("unauthenticated")],
    });

    expect(onboardingComplete(steps)).toBe(false);
  });
});
