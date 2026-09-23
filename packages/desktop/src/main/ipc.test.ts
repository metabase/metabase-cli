import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CredentialBroker } from "./auth/broker";
import { ConnectionRefresher } from "./auth/refresh";
import { cliLocation } from "./cli/paths";
import { MetabaseCli } from "./cli/runner";
import { Git } from "./git/service";
import { TEST_MODE_ENV_VAR, registerIpc, type MainDeps } from "./ipc";
import { MetabaseLoop } from "./metabase/loop";
import { MetabaseWorktrees } from "./metabase/worktrees";
import { AppUpdates } from "./updates";
import { runCommand, startProcess } from "./process/spawn";
import { ProviderDetector } from "./providers/detect";
import { PROVIDER_ADAPTERS } from "./providers/registry";
import { externalOpener } from "./external";
import { SessionChanges } from "./sessions/changes";
import { SessionEngine } from "./sessions/engine";
import { SessionStore } from "./sessions/store";
import { SettingsStore } from "./settings/store";

const PRODUCT_CHANNELS = [
  "settings.read",
  "settings.setTheme",
  "settings.setWorktreeRoot",
  "settings.setEditor",
  "settings.setLayout",
  "settings.setAgents",
  "connection.read",
  "connection.probe",
  "connection.connect",
  "connection.refresh",
  "connection.signOut",
  "repository.choose",
  "repository.clear",
  "repository.files",
  "providers.read",
  "providers.rescan",
  "sessions.list",
  "sessions.create",
  "sessions.open",
  "sessions.sendTurn",
  "sessions.answer",
  "sessions.interrupt",
  "sessions.stop",
  "sessions.archive",
  "sessions.delete",
  "sessions.pin",
  "sessions.rewind",
  "changes.read",
  "changes.revert",
  "changes.openFile",
  "files.tree",
  "files.preview",
  "branch.status",
  "branch.commit",
  "branch.push",
  "branch.openPullRequest",
  "metabase.panel",
  "metabase.content",
  "metabase.tree",
  "metabase.sync",
  "metabase.runTransform",
  "metabase.runTransformTests",
  "metabase.ignoreAppDirectories",
  "updates.read",
  "updates.download",
  "updates.install",
  "window.chrome",
];

const TEST_CHANNELS = [
  "test.folderQueue",
  "test.sessionMint",
  "test.sessionRevoke",
  "test.openedExternally",
];

const NEVER_ABORTED = new AbortController().signal;

const closers: Array<() => Promise<void>> = [];

async function channelsRegisteredUnder(env: NodeJS.ProcessEnv): Promise<string[]> {
  const directory = await mkdtemp(join(tmpdir(), "rde-ipc-"));
  const settings = await SettingsStore.open(directory);
  const connection = new ConnectionRefresher({
    persist: async () => undefined,
    now: Date.now,
    onChange: () => undefined,
    log: () => undefined,
  });
  const broker = await CredentialBroker.start({
    getAccessToken: () => connection.getAccessToken(),
    forceRefresh: () => connection.forceRefresh(),
    log: () => undefined,
    now: Date.now,
  });
  closers.push(async () => {
    await broker.close();
    await rm(directory, { recursive: true, force: true });
  });
  const providers = new ProviderDetector({
    probes: PROVIDER_ADAPTERS,
    preferences: () => settings.current().providers,
    path: async () => ({
      entries: [],
      value: "",
      loginShell: { kind: "read", shell: "/bin/sh" },
    }),
    env,
    run: runCommand,
    now: Date.now,
    platform: process.platform,
    signal: NEVER_ABORTED,
  });
  const git = new Git({ env, run: runCommand, start: startProcess, signal: NEVER_ABORTED });
  const opener = externalOpener({
    shell: {
      openExternal: async () => undefined,
      openPath: async () => "",
    },
    editor: () => null,
    startProcess,
    env,
    log: () => undefined,
  });
  const sessions = new SessionEngine({
    store: await SessionStore.open(directory),
    adapters: PROVIDER_ADAPTERS,
    providers,
    git,
    repository: () => settings.current().repository,
    worktreeRoot: () => join(directory, "worktrees"),
    mintBrokerSession: () => null,
    revokeBrokerSession: () => undefined,
    worktreeEnvironment: async () => ({}),
    removeMetabaseWorktree: async () => undefined,
    path: async () => ({
      entries: [],
      value: "",
      loginShell: { kind: "read", shell: "/bin/sh" },
    }),
    cli: cliLocation({ kind: "dev", outDir: join(directory, "out") }, process.execPath),
    providerLogDirectory: join(directory, "logs"),
    publish: () => undefined,
    startProcess,
    env,
    now: () => new Date(),
    log: () => undefined,
    signal: NEVER_ABORTED,
  });
  const changes = new SessionChanges({
    git,
    open: (sessionId) => sessions.open(sessionId),
    repository: () => settings.current().repository,
    openUrl: opener.openUrl,
    openFile: opener.openFile,
    publishPush: () => undefined,
  });
  const deps: MainDeps = {
    settings,
    git,
    homeDirectory: directory,
    sessions,
    changes,
    metabase: new MetabaseLoop({
      git,
      worktrees: new MetabaseWorktrees({
        cli: new MetabaseCli({
          location: cliLocation({ kind: "dev", outDir: join(directory, "out") }, process.execPath),
          run: runCommand,
          env,
          credentials: () => null,
          release: () => undefined,
          signal: NEVER_ABORTED,
        }),
        git,
        connection: () => connection.state(),
        cwd: directory,
        log: () => undefined,
      }),
      changes,
      open: (sessionId) => sessions.open(sessionId),
      connection: () => connection.state(),
      recordSync: (sessionId, branch, outcome) => sessions.recordSync(sessionId, branch, outcome),
      publish: () => undefined,
      log: () => undefined,
    }),
    updates: new AppUpdates({
      updater: {
        active: () => false,
        setFeed: () => undefined,
        check: async () => null,
        download: async () => null,
        install: () => undefined,
        on: () => undefined,
      },
      testMode: false,
      env,
      publish: () => undefined,
      log: () => undefined,
    }),
    opener,
    connection,
    broker,
    providers,
    secrets: {
      encrypt: () => {
        throw new Error("registration reaches no credential");
      },
      decrypt: () => {
        throw new Error("registration reaches no credential");
      },
    },
    chooseFolder: async () => ({ kind: "cancelled" }),
    onAuthorizeUrl: () => undefined,
    systemTheme: () => "light",
    onTheme: () => undefined,
    chrome: { kind: "controls-overlay" },
    log: () => undefined,
    now: Date.now,
    env,
    run: runCommand,
    signal: NEVER_ABORTED,
  };
  const registered: string[] = [];
  registerIpc(deps, (channel) => registered.push(channel));
  return registered;
}

afterEach(async () => {
  await Promise.all(closers.map((close) => close()));
  closers.length = 0;
});

describe("registerIpc", () => {
  it("registers no channel a driver owns when the environment is clean", async () => {
    expect(await channelsRegisteredUnder({})).toEqual(PRODUCT_CHANNELS);
  });

  it("registers the driver channels under the test-mode variable", async () => {
    expect(await channelsRegisteredUnder({ [TEST_MODE_ENV_VAR]: "1" })).toEqual([
      ...PRODUCT_CHANNELS,
      ...TEST_CHANNELS,
    ]);
  });
});
