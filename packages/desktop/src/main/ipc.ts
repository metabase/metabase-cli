import { errorMessage } from "@metabase/client/errors";

import type { SessionEnvironment } from "../contracts/connection";
import { ipc, ipcHandler, testIpc } from "../contracts/ipc";
import type { ProviderHealthList } from "../contracts/providers";
import type {
  RepositoryChoice,
  SettingsView,
  StoredCredential,
  Theme,
  TrackedFiles,
} from "../contracts/settings";
import type { WindowChrome } from "../contracts/window";

import type { CredentialBroker } from "./auth/broker";
import type { ExternalOpener } from "./external";
import type { MetabaseLoop } from "./metabase/loop";
import type { AppUpdates } from "./updates";
import type { SessionChanges } from "./sessions/changes";
import { TRACKED_FILE_LIMIT, listCheckoutFiles, type Git } from "./git/service";
import { sessionEnvironment } from "./auth/session-environment";
import type { SessionEngine } from "./sessions/engine";
import { resolveWorktreeRoot } from "./settings/worktree-root";
import { connect, connectOutcome, probeAuthMethod, revokeCredential } from "./auth/oauth";
import type { ConnectionRefresher } from "./auth/refresh";
import type { CredentialCipher } from "./auth/secret";
import type { RunCommand } from "./process/spawn";
import type { ProviderDetector } from "./providers/detect";
import { NOT_CONNECTED_MESSAGE } from "./auth/session-environment";
import { inspectRepository } from "./repository/inspect";
import { resolveTheme } from "./settings/theme";
import type { SettingsStore } from "./settings/store";
import type { TerminalHost } from "./terminals/host";

export const TEST_MODE_ENV_VAR = "RDE_TEST_MODE";

const ACKNOWLEDGED = { ok: true } as const;

const NO_TRACKED_FILES: TrackedFiles = { paths: [], truncated: false };

interface FolderChosen {
  readonly kind: "chosen";
  readonly path: string;
}

interface FolderPickerDismissed {
  readonly kind: "cancelled";
}

export type FolderSelection = FolderChosen | FolderPickerDismissed;

type IpcListener = (event: unknown, payload: unknown) => Promise<unknown>;

type IpcRegistrar = (channel: string, listener: IpcListener) => void;

export interface MainDeps {
  readonly settings: SettingsStore;
  readonly git: Git;
  readonly sessions: SessionEngine;
  readonly changes: SessionChanges;
  readonly metabase: MetabaseLoop;
  readonly terminals: TerminalHost;
  readonly updates: AppUpdates;
  readonly opener: ExternalOpener;
  readonly homeDirectory: string;
  readonly connection: ConnectionRefresher;
  readonly broker: CredentialBroker;
  readonly providers: ProviderDetector;
  readonly secrets: CredentialCipher;
  readonly chooseFolder: () => Promise<FolderSelection>;
  readonly onAuthorizeUrl: (url: string, opened: boolean) => void;
  readonly systemTheme: () => Theme;
  readonly onTheme: (theme: Theme) => void;
  readonly chrome: WindowChrome;
  readonly log: (message: string) => void;
  readonly now: () => number;
  readonly env: NodeJS.ProcessEnv;
  readonly run: RunCommand;
  readonly signal: AbortSignal;
}

export function testModeEnabled(env: NodeJS.ProcessEnv): boolean {
  const flag = env[TEST_MODE_ENV_VAR];
  return flag !== undefined && flag.length > 0;
}

export function registerIpc(deps: MainDeps, register: IpcRegistrar): void {
  const queuedFolders: string[] = [];

  const view = (): SettingsView => {
    const settings = deps.settings.current();
    return {
      theme: resolveTheme({
        preference: settings.theme,
        systemTheme: deps.systemTheme(),
        env: deps.env,
      }),
      themePreference: settings.theme,
      repository: settings.repository,
      worktreeRoot: resolveWorktreeRoot({
        configured: settings.worktreeRoot,
        repository: settings.repository,
        homeDirectory: deps.homeDirectory,
      }),
      editor: settings.editor,
      layout: settings.layout,
      agents: settings.agents,
    };
  };

  const selectFolder = async (): Promise<FolderSelection> => {
    const queued = queuedFolders.shift();
    if (queued !== undefined) {
      return { kind: "chosen", path: queued };
    }
    return deps.chooseFolder();
  };

  const chooseRepository = async (): Promise<RepositoryChoice> => {
    const selection = await selectFolder();
    if (selection.kind === "cancelled") {
      return { kind: "cancelled" };
    }
    const choice = await inspectRepository({ git: deps.git, path: selection.path });
    if (choice.kind === "rejected") {
      return choice;
    }
    await deps.settings.update((current) => ({ ...current, repository: choice.repository }));
    return { kind: "chosen", settings: view() };
  };

  const readProviders = (): Promise<ProviderHealthList> => deps.providers.read();

  register(
    ipc.settingsRead.name,
    ipcHandler(ipc.settingsRead, async () => view()),
  );

  register(
    ipc.settingsSetTheme.name,
    ipcHandler(ipc.settingsSetTheme, async (input) => {
      await deps.settings.update((current) => ({ ...current, theme: input.theme }));
      const next = view();
      deps.onTheme(next.theme);
      return next;
    }),
  );

  register(
    ipc.settingsSetWorktreeRoot.name,
    ipcHandler(ipc.settingsSetWorktreeRoot, async (input) => {
      const trimmed = input.path.trim();
      const worktreeRoot = trimmed.length === 0 ? null : trimmed;
      await deps.settings.update((current) => ({ ...current, worktreeRoot }));
      return view();
    }),
  );

  register(
    ipc.settingsSetEditor.name,
    ipcHandler(ipc.settingsSetEditor, async (input) => {
      const trimmed = input.command.trim();
      const editor = trimmed.length === 0 ? null : trimmed;
      await deps.settings.update((current) => ({ ...current, editor }));
      return view();
    }),
  );

  register(
    ipc.settingsSetLayout.name,
    ipcHandler(ipc.settingsSetLayout, async (layout) => {
      await deps.settings.update((current) => ({ ...current, layout }));
      return view();
    }),
  );

  register(
    ipc.settingsSetAgents.name,
    ipcHandler(ipc.settingsSetAgents, async (agents) => {
      await deps.settings.update((current) => ({ ...current, agents }));
      return view();
    }),
  );

  register(
    ipc.connectionRead.name,
    ipcHandler(ipc.connectionRead, async () => deps.connection.state()),
  );

  register(
    ipc.connectionProbe.name,
    ipcHandler(ipc.connectionProbe, (input) => probeAuthMethod(input.url, deps.signal)),
  );

  register(
    ipc.connectionConnect.name,
    ipcHandler(ipc.connectionConnect, async (input) => {
      const result = await connect(
        input,
        { openBrowser: deps.opener.openUrl, onAuthorizeUrl: deps.onAuthorizeUrl, now: deps.now },
        deps.signal,
      );
      if (result.kind === "failed") {
        return connectOutcome(result);
      }
      try {
        const credentialBlob = deps.secrets.encrypt(result.credential);
        const { url, user, server, connectedAt } = result.connected;
        await deps.settings.update((current) => ({
          ...current,
          metabase: { url, credentialBlob, user, server, connectedAt },
        }));
        deps.connection.adopt({ url, user, server, connectedAt, credential: result.credential });
      } catch (error) {
        return { kind: "failed", message: errorMessage(error) };
      }
      return connectOutcome(result);
    }),
  );

  register(
    ipc.connectionRefresh.name,
    ipcHandler(ipc.connectionRefresh, async () => {
      await deps.connection.forceRefresh();
      return deps.connection.state();
    }),
  );

  register(
    ipc.connectionSignOut.name,
    ipcHandler(ipc.connectionSignOut, async () => {
      const stored = deps.settings.current().metabase;
      if (stored !== null) {
        await revokeStored(deps, stored.url, stored.credentialBlob);
        await deps.settings.update((current) => ({ ...current, metabase: null }));
      }
      return deps.connection.signOut();
    }),
  );

  register(ipc.repositoryChoose.name, ipcHandler(ipc.repositoryChoose, chooseRepository));

  register(
    ipc.repositoryClear.name,
    ipcHandler(ipc.repositoryClear, async () => {
      await deps.settings.update((current) => ({ ...current, repository: null }));
      return view();
    }),
  );

  register(
    ipc.repositoryFiles.name,
    ipcHandler(ipc.repositoryFiles, async () => {
      const repository = deps.settings.current().repository;
      if (repository === null) {
        return NO_TRACKED_FILES;
      }
      return listCheckoutFiles(deps.git, repository.path, TRACKED_FILE_LIMIT);
    }),
  );

  register(ipc.providersRead.name, ipcHandler(ipc.providersRead, readProviders));

  register(
    ipc.providersRescan.name,
    ipcHandler(ipc.providersRescan, () => deps.providers.rescan()),
  );

  register(
    ipc.sessionsList.name,
    ipcHandler(ipc.sessionsList, async () => deps.sessions.index()),
  );

  register(
    ipc.sessionsCreate.name,
    ipcHandler(ipc.sessionsCreate, (input) => deps.sessions.create(input)),
  );

  register(
    ipc.sessionsOpen.name,
    ipcHandler(ipc.sessionsOpen, (input) => deps.sessions.open(input.sessionId)),
  );

  register(
    ipc.sessionsSendTurn.name,
    ipcHandler(ipc.sessionsSendTurn, async (input) => {
      await deps.sessions.sendTurn(input);
      return ACKNOWLEDGED;
    }),
  );

  register(
    ipc.sessionsAnswer.name,
    ipcHandler(ipc.sessionsAnswer, async (input) => {
      await deps.sessions.answer(input);
      return ACKNOWLEDGED;
    }),
  );

  register(
    ipc.sessionsInterrupt.name,
    ipcHandler(ipc.sessionsInterrupt, async (input) => {
      await deps.sessions.interrupt(input.sessionId);
      return ACKNOWLEDGED;
    }),
  );

  register(
    ipc.sessionsStop.name,
    ipcHandler(ipc.sessionsStop, async (input) => {
      await deps.sessions.stop(input.sessionId);
      return ACKNOWLEDGED;
    }),
  );

  register(
    ipc.sessionsArchive.name,
    ipcHandler(ipc.sessionsArchive, (input) => {
      deps.terminals.closeSession(input.sessionId);
      return deps.sessions.archive(input.sessionId);
    }),
  );

  register(
    ipc.sessionsDelete.name,
    ipcHandler(ipc.sessionsDelete, (input) => {
      deps.terminals.closeSession(input.sessionId);
      return deps.sessions.remove(input.sessionId);
    }),
  );

  register(
    ipc.sessionsPin.name,
    ipcHandler(ipc.sessionsPin, (input) => deps.sessions.setPinned(input)),
  );

  register(
    ipc.sessionsRewind.name,
    ipcHandler(ipc.sessionsRewind, (input) => deps.sessions.rewind(input)),
  );

  register(
    ipc.changesRead.name,
    ipcHandler(ipc.changesRead, (input) => deps.changes.read(input)),
  );

  register(
    ipc.changesRevert.name,
    ipcHandler(ipc.changesRevert, (input) => deps.changes.revert(input)),
  );

  register(
    ipc.changesOpenFile.name,
    ipcHandler(ipc.changesOpenFile, (input) => deps.changes.openFile(input)),
  );

  register(
    ipc.filesTree.name,
    ipcHandler(ipc.filesTree, (input) => deps.changes.tree(input.sessionId)),
  );

  register(
    ipc.filesPreview.name,
    ipcHandler(ipc.filesPreview, (input) => deps.changes.preview(input)),
  );

  register(
    ipc.branchStatus.name,
    ipcHandler(ipc.branchStatus, (input) => deps.changes.status(input.sessionId)),
  );

  register(
    ipc.branchCommit.name,
    ipcHandler(ipc.branchCommit, (input) => deps.changes.commit(input)),
  );

  register(
    ipc.branchPush.name,
    ipcHandler(ipc.branchPush, (input) => deps.changes.push(input)),
  );

  register(
    ipc.branchOpenPullRequest.name,
    ipcHandler(ipc.branchOpenPullRequest, (input) => deps.changes.openPullRequest(input.sessionId)),
  );

  register(
    ipc.metabasePanel.name,
    ipcHandler(ipc.metabasePanel, (input) => deps.metabase.panel(input.sessionId)),
  );

  register(
    ipc.metabaseContent.name,
    ipcHandler(ipc.metabaseContent, (input) => deps.metabase.content(input.sessionId)),
  );

  register(
    ipc.metabaseTree.name,
    ipcHandler(ipc.metabaseTree, (input) => deps.metabase.tree(input.sessionId)),
  );

  register(
    ipc.metabaseSync.name,
    ipcHandler(ipc.metabaseSync, (input) => deps.metabase.sync(input)),
  );

  register(
    ipc.metabaseRunTransform.name,
    ipcHandler(ipc.metabaseRunTransform, (input) => deps.metabase.runTransform(input)),
  );

  register(
    ipc.metabaseRunTransformTests.name,
    ipcHandler(ipc.metabaseRunTransformTests, (input) => deps.metabase.runTransformTests(input)),
  );

  register(
    ipc.metabaseIgnoreAppDirectories.name,
    ipcHandler(ipc.metabaseIgnoreAppDirectories, (input) =>
      deps.metabase.ignoreAppDirectories(input.sessionId),
    ),
  );

  register(
    ipc.terminalOpen.name,
    ipcHandler(ipc.terminalOpen, (input) => deps.terminals.open(input)),
  );

  register(
    ipc.terminalWrite.name,
    ipcHandler(ipc.terminalWrite, async (input) => {
      deps.terminals.write(input);
      return ACKNOWLEDGED;
    }),
  );

  register(
    ipc.terminalResize.name,
    ipcHandler(ipc.terminalResize, async (input) => {
      deps.terminals.resize(input);
      return ACKNOWLEDGED;
    }),
  );

  register(
    ipc.terminalClose.name,
    ipcHandler(ipc.terminalClose, async (input) => {
      deps.terminals.close(input.terminalId);
      return ACKNOWLEDGED;
    }),
  );

  register(
    ipc.updatesRead.name,
    ipcHandler(ipc.updatesRead, async () => deps.updates.state()),
  );

  register(
    ipc.updatesDownload.name,
    ipcHandler(ipc.updatesDownload, () => deps.updates.download()),
  );

  register(
    ipc.updatesInstall.name,
    ipcHandler(ipc.updatesInstall, async () => deps.updates.install()),
  );

  register(
    ipc.windowChrome.name,
    ipcHandler(ipc.windowChrome, async () => deps.chrome),
  );

  if (!testModeEnabled(deps.env)) {
    return;
  }

  register(
    testIpc.testFolderQueue.name,
    ipcHandler(testIpc.testFolderQueue, async (input) => {
      queuedFolders.push(input.path);
      return ACKNOWLEDGED;
    }),
  );

  register(
    testIpc.testSessionMint.name,
    ipcHandler(testIpc.testSessionMint, async () => mintForTest(deps)),
  );

  register(
    testIpc.testSessionRevoke.name,
    ipcHandler(testIpc.testSessionRevoke, async (input) => {
      deps.broker.revokeSession(input.sessionId);
      return ACKNOWLEDGED;
    }),
  );

  const opener = deps.opener;
  if (opener.kind === "recording") {
    register(
      testIpc.testOpenedExternally.name,
      ipcHandler(testIpc.testOpenedExternally, async () => opener.opened()),
    );
  }
}

function mintForTest(deps: MainDeps): SessionEnvironment {
  const minted = sessionEnvironment(deps.broker, deps.connection.state());
  if (minted === null) {
    throw new Error(NOT_CONNECTED_MESSAGE);
  }
  return minted;
}

async function revokeStored(deps: MainDeps, url: string, credentialBlob: string): Promise<void> {
  const credential = readStoredCredential(deps, credentialBlob);
  if (credential === null || credential.kind !== "oauth") {
    return;
  }
  const outcome = await revokeCredential(url, credential);
  if (outcome.kind === "failed") {
    deps.log(`sign-out: ${url} did not revoke the credential: ${outcome.message}`);
  }
}

function readStoredCredential(deps: MainDeps, credentialBlob: string): StoredCredential | null {
  try {
    return deps.secrets.decrypt(credentialBlob);
  } catch (error) {
    deps.log(`sign-out: the stored credential could not be read: ${errorMessage(error)}`);
    return null;
  }
}
