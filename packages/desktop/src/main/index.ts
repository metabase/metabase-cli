import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { BrowserWindow, app, dialog, ipcMain, nativeTheme, shell } from "electron";
import { autoUpdater } from "electron-updater";

import { errorMessage } from "@metabase/client/errors";

import type { Settings, Theme } from "../contracts/settings";
import type { WindowChrome } from "../contracts/window";

import type { SessionEventBatch } from "../contracts/session";

import { CredentialBroker } from "./auth/broker";
import { ConnectionRefresher } from "./auth/refresh";
import { credentialCipher } from "./auth/secret";
import { sessionEnvironment } from "./auth/session-environment";
import { Git } from "./git/service";
import { ipcPush } from "../contracts/ipc";
import { externalOpener, type ExternalOpener } from "./external";
import { appIconPath, cliLocation, type AppLayout } from "./cli/paths";
import { MetabaseCli } from "./cli/runner";
import { registerIpc, testModeEnabled, type FolderSelection, type MainDeps } from "./ipc";
import { MetabaseLoop } from "./metabase/loop";
import { MetabaseWorktrees } from "./metabase/worktrees";
import { mergedPath } from "./process/path";
import { startPty } from "./process/pty";
import { runCommand, startProcess } from "./process/spawn";
import { ProviderDetector } from "./providers/detect";
import { PROVIDER_ADAPTERS } from "./providers/registry";
import { SessionChanges } from "./sessions/changes";
import { SessionEngine } from "./sessions/engine";
import { sessionProcessEnvironment } from "./sessions/environment";
import { SessionStore } from "./sessions/store";
import { SettingsStore } from "./settings/store";
import { resolveTheme } from "./settings/theme";
import { resolveWorktreeRoot } from "./settings/worktree-root";
import { TerminalHost, userShell } from "./terminals/host";
import { AppUpdates, type Updater } from "./updates";
import { type RendererEntry, applyWindowTheme, createMainWindow, windowChrome } from "./window";

const EXIT_STARTUP_FAILURE = 1;

const OUT_DIR = join(import.meta.dirname, "..");
const PRELOAD_PATH = join(OUT_DIR, "preload", "index.cjs");
const RENDERER_INDEX = join(OUT_DIR, "renderer", "index.html");

const REPOSITORY_PICKER_TITLE = "Choose a repository";

const PROVIDER_LOGS_SEGMENTS = ["logs", "providers"];

const TERMINAL_ID_PREFIX = "term_";

function resolveRendererEntry(env: NodeJS.ProcessEnv): RendererEntry {
  const devServerUrl = env.ELECTRON_RENDERER_URL;
  if (devServerUrl !== undefined) {
    return { kind: "dev-server", url: devServerUrl };
  }
  return { kind: "built-file", path: RENDERER_INDEX };
}

function appLayout(): AppLayout {
  return app.isPackaged
    ? { kind: "packaged", resourcesPath: process.resourcesPath }
    : { kind: "dev", outDir: OUT_DIR };
}

interface WindowLook {
  readonly chrome: WindowChrome;
  readonly theme: () => Theme;
}

function openMainWindow(opener: ExternalOpener, look: WindowLook): BrowserWindow {
  return createMainWindow({
    entry: resolveRendererEntry(process.env),
    preloadPath: PRELOAD_PATH,
    chrome: look.chrome,
    theme: look.theme(),
    icon: appIconPath(appLayout()),
    openUrl: opener.openUrl,
  });
}

function focusExistingWindow(): void {
  const [existing] = BrowserWindow.getAllWindows();
  if (existing === undefined) {
    return;
  }
  if (existing.isMinimized()) {
    existing.restore();
  }
  existing.focus();
}

function systemTheme(): Theme {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light";
}

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

function isBrokenPipe(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EPIPE";
}

// When whatever launched the app exits, its output pipe closes and the next write is an
// uncaught EPIPE that Electron shows as a crash. Nobody is left to read that line.
function surviveClosedOutput(stream: NodeJS.WriteStream): void {
  stream.on("error", (error) => {
    if (!isBrokenPipe(error)) {
      throw error;
    }
  });
}

async function chooseFolder(): Promise<FolderSelection> {
  const picked = await dialog.showOpenDialog({
    title: REPOSITORY_PICKER_TITLE,
    properties: ["openDirectory", "createDirectory"],
  });
  const [path] = picked.filePaths;
  if (picked.canceled || path === undefined) {
    return { kind: "cancelled" };
  }
  return { kind: "chosen", path };
}

// The renderer's toast asks before anything downloads.
function electronUpdater(): Updater {
  autoUpdater.autoDownload = false;
  return {
    active: () => autoUpdater.isUpdaterActive(),
    setFeed: (url) => {
      autoUpdater.setFeedURL({ provider: "generic", url });
    },
    check: () => autoUpdater.checkForUpdates(),
    download: () => autoUpdater.downloadUpdate(),
    install: () => {
      autoUpdater.quitAndInstall();
    },
    on: (event, listener) => {
      autoUpdater.on(event, listener);
    },
  };
}

// A refresh that lands after a sign-out has no credential left to replace.
function withCredentialBlob(settings: Settings, credentialBlob: string): Settings {
  const stored = settings.metabase;
  if (stored === null) {
    return settings;
  }
  return { ...settings, metabase: { ...stored, credentialBlob } };
}

function restoreConnection(store: SettingsStore, connection: ConnectionRefresher): void {
  const stored = store.current().metabase;
  if (stored === null) {
    return;
  }
  try {
    connection.adopt({
      url: stored.url,
      user: stored.user,
      server: stored.server,
      connectedAt: stored.connectedAt,
      credential: credentialCipher.decrypt(stored.credentialBlob),
    });
  } catch (error) {
    log(`startup: the stored Metabase credential could not be read: ${errorMessage(error)}`);
  }
}

async function start(interrupt: AbortSignal): Promise<void> {
  await app.whenReady();
  // A packaged macOS app takes its Dock icon from the bundle; a dev run is Electron's own bundle.
  if (!app.isPackaged) {
    app.dock?.setIcon(appIconPath(appLayout()));
  }

  const store = await SettingsStore.open(app.getPath("userData"));
  const connection = new ConnectionRefresher({
    persist: async (credential) => {
      if (store.current().metabase === null) {
        return;
      }
      const credentialBlob = credentialCipher.encrypt(credential);
      await store.update((current) => withCredentialBlob(current, credentialBlob));
    },
    now: Date.now,
    onChange: (state) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(ipcPush.connectionState.name, state);
      }
    },
    log,
  });
  restoreConnection(store, connection);

  const broker = await CredentialBroker.start({
    getAccessToken: () => connection.getAccessToken(),
    forceRefresh: () => connection.forceRefresh(),
    log,
    now: Date.now,
  });
  app.on("will-quit", () => {
    void broker.close();
  });

  const publish = (batch: SessionEventBatch): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(ipcPush.sessionEvents.name, batch);
    }
  };

  const providers = new ProviderDetector({
    probes: PROVIDER_ADAPTERS,
    preferences: () => store.current().providers,
    path: () => mergedPath({ env: process.env, run: runCommand, signal: interrupt }),
    env: process.env,
    run: runCommand,
    now: Date.now,
    platform: process.platform,
    signal: interrupt,
  });

  const git = new Git({
    env: process.env,
    run: runCommand,
    start: startProcess,
    signal: interrupt,
  });
  const cli = cliLocation(appLayout(), process.execPath);
  const worktrees = new MetabaseWorktrees({
    cli: new MetabaseCli({
      location: cli,
      run: runCommand,
      env: process.env,
      credentials: (worktree) => sessionEnvironment(broker, connection.state(), worktree),
      release: (brokerSessionId) => {
        broker.revokeSession(brokerSessionId);
      },
      signal: interrupt,
    }),
    git,
    connection: () => connection.state(),
    cwd: app.getPath("userData"),
    log,
  });
  const sessionStore = await SessionStore.open(app.getPath("userData"));
  const sessions = new SessionEngine({
    store: sessionStore,
    adapters: PROVIDER_ADAPTERS,
    providers,
    git,
    repository: () => store.current().repository,
    worktreeRoot: () =>
      resolveWorktreeRoot({
        configured: store.current().worktreeRoot,
        repository: store.current().repository,
        homeDirectory: app.getPath("home"),
      }),
    mintBrokerSession: (session) =>
      sessionEnvironment(broker, connection.state(), () => worktrees.worktree(session)),
    revokeBrokerSession: (sessionId) => {
      broker.revokeSession(sessionId);
    },
    worktree: (session) => worktrees.worktree(session),
    removeMetabaseWorktree: (session, otherBranches) => worktrees.remove(session, otherBranches),
    path: () => mergedPath({ env: process.env, run: runCommand, signal: interrupt }),
    cli,
    providerLogDirectory: join(app.getPath("userData"), ...PROVIDER_LOGS_SEGMENTS),
    publish,
    startProcess,
    env: process.env,
    now: () => new Date(),
    log,
    signal: interrupt,
  });
  const terminals = new TerminalHost({
    open: (sessionId) => sessions.open(sessionId),
    environment: (session, brokerEnv) =>
      sessionProcessEnvironment(
        {
          env: process.env,
          cli,
          path: () => mergedPath({ env: process.env, run: runCommand, signal: interrupt }),
          worktree: (scoped) => worktrees.worktree(scoped),
        },
        session,
        brokerEnv,
      ),
    mintBrokerSession: (session) =>
      sessionEnvironment(broker, connection.state(), () => worktrees.worktree(session)),
    revokeBrokerSession: (sessionId) => {
      broker.revokeSession(sessionId);
    },
    shell: userShell(process.env, process.platform),
    startPty,
    newId: () => `${TERMINAL_ID_PREFIX}${randomUUID()}`,
    publishOutput: (output) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(ipcPush.terminalOutput.name, output);
      }
    },
    publishExit: (exit) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(ipcPush.terminalExit.name, exit);
      }
    },
  });
  app.on("will-quit", () => {
    terminals.closeAll();
  });

  // Quitting must outlive the agent processes a session owns, so the first quit is held until
  // every session has stopped and the second one, which shutdown triggers, goes through.
  let stopping = false;
  app.on("before-quit", (event) => {
    if (stopping) {
      return;
    }
    stopping = true;
    event.preventDefault();
    void sessions.shutdown().finally(() => {
      app.quit();
    });
  });

  const opener = externalOpener({
    shell: {
      openExternal: (url) => shell.openExternal(url),
      openPath: (path) => shell.openPath(path),
    },
    editor: () => store.current().editor,
    startProcess,
    env: process.env,
    log,
  });
  const changes = new SessionChanges({
    git,
    open: (sessionId) => sessions.open(sessionId),
    repository: () => store.current().repository,
    openUrl: opener.openUrl,
    openFile: opener.openFile,
    publishPush: (sessionId, text) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(ipcPush.pushOutput.name, { sessionId, text });
      }
    },
  });

  const metabase = new MetabaseLoop({
    git,
    worktrees,
    changes,
    open: (sessionId) => sessions.open(sessionId),
    connection: () => connection.state(),
    recordSync: (sessionId, branch, outcome) => sessions.recordSync(sessionId, branch, outcome),
    publish: (output) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(ipcPush.syncOutput.name, output);
      }
    },
    log,
  });

  const updates = new AppUpdates({
    updater: electronUpdater(),
    testMode: testModeEnabled(process.env),
    env: process.env,
    publish: (state) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(ipcPush.updateState.name, state);
      }
    },
    log,
  });
  app.on("will-quit", () => {
    updates.stop();
  });

  const look: WindowLook = {
    chrome: windowChrome(process.platform),
    theme: () =>
      resolveTheme({
        preference: store.current().theme,
        systemTheme: systemTheme(),
        env: process.env,
      }),
  };

  const deps: MainDeps = {
    settings: store,
    git,
    sessions,
    changes,
    metabase,
    terminals,
    updates,
    opener,
    homeDirectory: app.getPath("home"),
    connection,
    broker,
    providers,
    secrets: credentialCipher,
    chooseFolder,
    onAuthorizeUrl: (url, opened) => {
      log(opened ? `oauth: opened ${url}` : `oauth: open ${url} to authorize`);
    },
    systemTheme,
    onTheme: (theme) => {
      for (const window of BrowserWindow.getAllWindows()) {
        applyWindowTheme(window, look.chrome, theme);
      }
    },
    chrome: look.chrome,
    log,
    now: Date.now,
    env: process.env,
    run: runCommand,
    signal: interrupt,
  };
  registerIpc(deps, (channel, listener) => {
    ipcMain.handle(channel, listener);
  });

  openMainWindow(opener, look);
  void providers.read();
  updates.start();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      openMainWindow(opener, look);
    }
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function failStartup(error: unknown): void {
  process.stderr.write(`RDE failed to start: ${errorMessage(error)}\n`);
  app.exit(EXIT_STARTUP_FAILURE);
}

surviveClosedOutput(process.stdout);
surviveClosedOutput(process.stderr);

if (app.requestSingleInstanceLock()) {
  const interrupt = new AbortController();
  app.on("second-instance", focusExistingWindow);
  app.on("will-quit", () => {
    interrupt.abort();
  });
  start(interrupt.signal).catch(failStartup);
} else {
  app.quit();
}
