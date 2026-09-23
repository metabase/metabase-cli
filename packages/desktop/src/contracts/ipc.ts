import { z } from "zod";

import {
  AuthMethod,
  ConnectOutcome,
  ConnectRequest,
  ConnectionState,
  ProbeRequest,
  SessionEnvironment,
} from "./connection";
import {
  ActionOutcome,
  BranchStatus,
  ChangeSet,
  ChangesRequest,
  CommitRequest,
  FileRef,
  OpenedExternally,
  PullRequestOutcome,
  OutputChunk,
  PushRequest,
  RevertRequest,
  RewindRequest,
} from "./changes";
import { FilePreview, SessionTree } from "./files";
import { PanelLayout } from "./layout";
import {
  MetabasePanelState,
  SessionContent,
  SyncRequest,
  SyncedTree,
  TransformRequest,
  TransformRunOutcome,
  TransformTestsOutcome,
} from "./metabase";
import { ProviderHealthList } from "./providers";
import {
  AnswerRequest,
  ArchiveOutcome,
  CreateSessionRequest,
  PinRequest,
  SessionEventBatch,
  SessionIndex,
  SessionOutcome,
  SessionRef,
  SessionSnapshot,
  TurnRequest,
} from "./session";
import {
  AgentDefaults,
  EditorRequest,
  RepositoryChoice,
  SettingsView,
  ThemeRequest,
  TrackedFiles,
  WorktreeRootRequest,
} from "./settings";
import { UpdateState } from "./updates";
import { WindowChrome } from "./window";

interface IpcChannel<Input, Output> {
  readonly name: string;
  readonly input: z.ZodType<Input>;
  readonly output: z.ZodType<Output>;
}

interface IpcPushChannel<Payload> {
  readonly name: string;
  readonly payload: z.ZodType<Payload>;
}

const FolderRequest = z.object({ path: z.string().min(1) }).strict();
const Acknowledged = z.object({ ok: z.literal(true) }).strict();

export const ipc = {
  settingsRead: { name: "settings.read", input: z.undefined(), output: SettingsView },
  settingsSetTheme: { name: "settings.setTheme", input: ThemeRequest, output: SettingsView },
  settingsSetWorktreeRoot: {
    name: "settings.setWorktreeRoot",
    input: WorktreeRootRequest,
    output: SettingsView,
  },
  settingsSetEditor: { name: "settings.setEditor", input: EditorRequest, output: SettingsView },
  settingsSetLayout: { name: "settings.setLayout", input: PanelLayout, output: SettingsView },
  settingsSetAgents: { name: "settings.setAgents", input: AgentDefaults, output: SettingsView },
  connectionRead: { name: "connection.read", input: z.undefined(), output: ConnectionState },
  connectionProbe: { name: "connection.probe", input: ProbeRequest, output: AuthMethod },
  connectionConnect: { name: "connection.connect", input: ConnectRequest, output: ConnectOutcome },
  connectionRefresh: {
    name: "connection.refresh",
    input: z.undefined(),
    output: ConnectionState,
  },
  connectionSignOut: { name: "connection.signOut", input: z.undefined(), output: ConnectionState },
  repositoryChoose: { name: "repository.choose", input: z.undefined(), output: RepositoryChoice },
  repositoryClear: { name: "repository.clear", input: z.undefined(), output: SettingsView },
  repositoryFiles: { name: "repository.files", input: z.undefined(), output: TrackedFiles },
  providersRead: { name: "providers.read", input: z.undefined(), output: ProviderHealthList },
  providersRescan: { name: "providers.rescan", input: z.undefined(), output: ProviderHealthList },
  sessionsList: { name: "sessions.list", input: z.undefined(), output: SessionIndex },
  sessionsCreate: { name: "sessions.create", input: CreateSessionRequest, output: SessionOutcome },
  sessionsOpen: { name: "sessions.open", input: SessionRef, output: SessionSnapshot },
  sessionsSendTurn: { name: "sessions.sendTurn", input: TurnRequest, output: Acknowledged },
  sessionsAnswer: { name: "sessions.answer", input: AnswerRequest, output: Acknowledged },
  sessionsInterrupt: { name: "sessions.interrupt", input: SessionRef, output: Acknowledged },
  sessionsStop: { name: "sessions.stop", input: SessionRef, output: Acknowledged },
  sessionsArchive: { name: "sessions.archive", input: SessionRef, output: ArchiveOutcome },
  sessionsDelete: { name: "sessions.delete", input: SessionRef, output: SessionIndex },
  sessionsPin: { name: "sessions.pin", input: PinRequest, output: SessionIndex },
  sessionsRewind: { name: "sessions.rewind", input: RewindRequest, output: SessionSnapshot },
  changesRead: { name: "changes.read", input: ChangesRequest, output: ChangeSet },
  changesRevert: { name: "changes.revert", input: RevertRequest, output: ActionOutcome },
  changesOpenFile: { name: "changes.openFile", input: FileRef, output: ActionOutcome },
  filesTree: { name: "files.tree", input: SessionRef, output: SessionTree },
  filesPreview: { name: "files.preview", input: FileRef, output: FilePreview },
  branchStatus: { name: "branch.status", input: SessionRef, output: BranchStatus },
  branchCommit: { name: "branch.commit", input: CommitRequest, output: ActionOutcome },
  branchPush: { name: "branch.push", input: PushRequest, output: ActionOutcome },
  branchOpenPullRequest: {
    name: "branch.openPullRequest",
    input: SessionRef,
    output: PullRequestOutcome,
  },
  metabasePanel: { name: "metabase.panel", input: SessionRef, output: MetabasePanelState },
  metabaseContent: { name: "metabase.content", input: SessionRef, output: SessionContent },
  metabaseTree: { name: "metabase.tree", input: SessionRef, output: SyncedTree },
  metabaseSync: { name: "metabase.sync", input: SyncRequest, output: ActionOutcome },
  metabaseRunTransform: {
    name: "metabase.runTransform",
    input: TransformRequest,
    output: TransformRunOutcome,
  },
  metabaseRunTransformTests: {
    name: "metabase.runTransformTests",
    input: TransformRequest,
    output: TransformTestsOutcome,
  },
  metabaseRefreshMetadata: {
    name: "metabase.refreshMetadata",
    input: SessionRef,
    output: ActionOutcome,
  },
  metabaseIgnoreAppDirectories: {
    name: "metabase.ignoreAppDirectories",
    input: SessionRef,
    output: ActionOutcome,
  },
  updatesRead: { name: "updates.read", input: z.undefined(), output: UpdateState },
  updatesDownload: { name: "updates.download", input: z.undefined(), output: UpdateState },
  updatesInstall: { name: "updates.install", input: z.undefined(), output: UpdateState },
  windowChrome: { name: "window.chrome", input: z.undefined(), output: WindowChrome },
} as const;

// Main sends these; the renderer subscribes. A push carries no reply, so its schema is one payload
// rather than an input and an output.
export const ipcPush = {
  sessionEvents: { name: "sessions.events", payload: SessionEventBatch },
  pushOutput: { name: "branch.pushOutput", payload: OutputChunk },
  syncOutput: { name: "metabase.syncOutput", payload: OutputChunk },
  updateState: { name: "updates.state", payload: UpdateState },
  connectionState: { name: "connection.state", payload: ConnectionState },
} as const;

export const testIpc = {
  testFolderQueue: { name: "test.folderQueue", input: FolderRequest, output: Acknowledged },
  testSessionMint: { name: "test.sessionMint", input: z.undefined(), output: SessionEnvironment },
  testSessionRevoke: { name: "test.sessionRevoke", input: SessionRef, output: Acknowledged },
  testOpenedExternally: {
    name: "test.openedExternally",
    input: z.undefined(),
    output: OpenedExternally,
  },
} as const;

type IpcMethod<Input extends z.ZodType, Output extends z.ZodType> = Input extends z.ZodUndefined
  ? () => Promise<z.output<Output>>
  : (input: z.input<Input>) => Promise<z.output<Output>>;

type IpcTable = typeof ipc & typeof testIpc;

type IpcMethods = {
  readonly [Name in keyof IpcTable]: IpcMethod<IpcTable[Name]["input"], IpcTable[Name]["output"]>;
};

export type Unsubscribe = () => void;

export interface IpcSubscriptions {
  readonly onSessionEvents: (listener: (batch: SessionEventBatch) => void) => Unsubscribe;
  readonly onPushOutput: (listener: (output: OutputChunk) => void) => Unsubscribe;
  readonly onSyncOutput: (listener: (output: OutputChunk) => void) => Unsubscribe;
  readonly onUpdateState: (listener: (state: UpdateState) => void) => Unsubscribe;
  readonly onConnectionState: (listener: (state: ConnectionState) => void) => Unsubscribe;
}

export type IpcBridge = IpcMethods & IpcSubscriptions;

type IpcTransport = (channel: string, payload: unknown) => Promise<unknown>;

export type IpcSubscribe = (channel: string, listener: (payload: unknown) => void) => Unsubscribe;

type IpcHandler<Input, Output> = (input: Input) => Promise<Output>;

type IpcListener<Output> = (event: unknown, payload: unknown) => Promise<Output>;

type IpcSide = "input" | "output";

const ROOT_LOCATION = "(root)";

function issueLocation(issue: z.core.$ZodIssue): string {
  if (issue.path.length === 0) {
    return ROOT_LOCATION;
  }
  return issue.path.map(String).join(".");
}

export class IpcContractError extends Error {
  constructor(channel: string, side: IpcSide, error: z.ZodError) {
    const issues = error.issues
      .map((issue) => `${issueLocation(issue)}: ${issue.message}`)
      .join("; ");
    super(`IPC channel "${channel}" rejected its ${side}: ${issues}`);
    this.name = "IpcContractError";
  }
}

function parseSide<Value>(
  channel: string,
  side: IpcSide,
  schema: z.ZodType<Value>,
  raw: unknown,
): Value {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new IpcContractError(channel, side, result.error);
  }
  return result.data;
}

export function ipcHandler<Input, Output>(
  channel: IpcChannel<Input, Output>,
  handler: IpcHandler<Input, Output>,
): IpcListener<Output> {
  return async (_event, payload) => {
    const input = parseSide(channel.name, "input", channel.input, payload);
    const output = await handler(input);
    return parseSide(channel.name, "output", channel.output, output);
  };
}

// Electron rejects a failed invoke with "Error invoking remote method '<channel>': <Name>: <message>".
// The page shows the message main wrote for a person, never the transport's framing or the class.
const REMOTE_FRAMING = /^Error invoking remote method '[^']*': (?:[A-Za-z]+: )?/;

export class IpcRemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IpcRemoteError";
  }
}

function remoteFailure(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new IpcRemoteError(message.replace(REMOTE_FRAMING, ""));
}

export function createIpcBridge(transport: IpcTransport, subscribe: IpcSubscribe): IpcBridge {
  const invoke = async <Input, Output>(
    channel: IpcChannel<Input, Output>,
    input: Input,
  ): Promise<Output> => {
    const raw = await transport(channel.name, input).catch((error: unknown) => {
      throw remoteFailure(error);
    });
    return parseSide(channel.name, "output", channel.output, raw);
  };
  const listen = <Payload>(
    channel: IpcPushChannel<Payload>,
    listener: (payload: Payload) => void,
  ): Unsubscribe =>
    subscribe(channel.name, (raw) => {
      listener(parseSide(channel.name, "output", channel.payload, raw));
    });
  return {
    settingsRead: () => invoke(ipc.settingsRead, undefined),
    settingsSetTheme: (input) => invoke(ipc.settingsSetTheme, input),
    settingsSetWorktreeRoot: (input) => invoke(ipc.settingsSetWorktreeRoot, input),
    settingsSetEditor: (input) => invoke(ipc.settingsSetEditor, input),
    settingsSetLayout: (input) => invoke(ipc.settingsSetLayout, input),
    settingsSetAgents: (input) => invoke(ipc.settingsSetAgents, input),
    connectionRead: () => invoke(ipc.connectionRead, undefined),
    connectionProbe: (input) => invoke(ipc.connectionProbe, input),
    connectionConnect: (input) => invoke(ipc.connectionConnect, input),
    connectionRefresh: () => invoke(ipc.connectionRefresh, undefined),
    connectionSignOut: () => invoke(ipc.connectionSignOut, undefined),
    repositoryChoose: () => invoke(ipc.repositoryChoose, undefined),
    repositoryClear: () => invoke(ipc.repositoryClear, undefined),
    repositoryFiles: () => invoke(ipc.repositoryFiles, undefined),
    providersRead: () => invoke(ipc.providersRead, undefined),
    providersRescan: () => invoke(ipc.providersRescan, undefined),
    testFolderQueue: (input) => invoke(testIpc.testFolderQueue, input),
    testSessionMint: () => invoke(testIpc.testSessionMint, undefined),
    testSessionRevoke: (input) => invoke(testIpc.testSessionRevoke, input),
    testOpenedExternally: () => invoke(testIpc.testOpenedExternally, undefined),
    sessionsList: () => invoke(ipc.sessionsList, undefined),
    sessionsCreate: (input) => invoke(ipc.sessionsCreate, input),
    sessionsOpen: (input) => invoke(ipc.sessionsOpen, input),
    sessionsSendTurn: (input) => invoke(ipc.sessionsSendTurn, input),
    sessionsAnswer: (input) => invoke(ipc.sessionsAnswer, input),
    sessionsInterrupt: (input) => invoke(ipc.sessionsInterrupt, input),
    sessionsStop: (input) => invoke(ipc.sessionsStop, input),
    sessionsArchive: (input) => invoke(ipc.sessionsArchive, input),
    sessionsDelete: (input) => invoke(ipc.sessionsDelete, input),
    sessionsPin: (input) => invoke(ipc.sessionsPin, input),
    sessionsRewind: (input) => invoke(ipc.sessionsRewind, input),
    changesRead: (input) => invoke(ipc.changesRead, input),
    changesRevert: (input) => invoke(ipc.changesRevert, input),
    changesOpenFile: (input) => invoke(ipc.changesOpenFile, input),
    filesTree: (input) => invoke(ipc.filesTree, input),
    filesPreview: (input) => invoke(ipc.filesPreview, input),
    branchStatus: (input) => invoke(ipc.branchStatus, input),
    branchCommit: (input) => invoke(ipc.branchCommit, input),
    branchPush: (input) => invoke(ipc.branchPush, input),
    branchOpenPullRequest: (input) => invoke(ipc.branchOpenPullRequest, input),
    metabasePanel: (input) => invoke(ipc.metabasePanel, input),
    metabaseContent: (input) => invoke(ipc.metabaseContent, input),
    metabaseTree: (input) => invoke(ipc.metabaseTree, input),
    metabaseSync: (input) => invoke(ipc.metabaseSync, input),
    metabaseRunTransform: (input) => invoke(ipc.metabaseRunTransform, input),
    metabaseRunTransformTests: (input) => invoke(ipc.metabaseRunTransformTests, input),
    metabaseRefreshMetadata: (input) => invoke(ipc.metabaseRefreshMetadata, input),
    metabaseIgnoreAppDirectories: (input) => invoke(ipc.metabaseIgnoreAppDirectories, input),
    updatesRead: () => invoke(ipc.updatesRead, undefined),
    updatesDownload: () => invoke(ipc.updatesDownload, undefined),
    updatesInstall: () => invoke(ipc.updatesInstall, undefined),
    windowChrome: () => invoke(ipc.windowChrome, undefined),
    onSessionEvents: (listener) => listen(ipcPush.sessionEvents, listener),
    onPushOutput: (listener) => listen(ipcPush.pushOutput, listener),
    onSyncOutput: (listener) => listen(ipcPush.syncOutput, listener),
    onUpdateState: (listener) => listen(ipcPush.updateState, listener),
    onConnectionState: (listener) => listen(ipcPush.connectionState, listener),
  };
}
