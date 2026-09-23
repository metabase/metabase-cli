import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleMinus,
  CloudOff,
  ExternalLink,
  EyeOff,
  FileX,
  FolderOpen,
  GitBranch,
  LayoutList,
  Play,
  RefreshCw,
  TestTube,
  Upload,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

import type { ActionOutcome, DiffFile } from "../../contracts/changes";
import type { ConnectionState } from "../../contracts/connection";
import type {
  MetabasePanelState,
  MetabaseWorktree,
  SessionContent,
  SyncedTree,
  TransformRunOutcome,
  TransformTestsOutcome,
} from "../../contracts/metabase";
import type { SessionSnapshot } from "../../contracts/session";
import type { ConnectedFeatures, Theme } from "../../contracts/settings";
import { assertNever } from "../../contracts/assert-never";
import { rde } from "@/bridge";
import { cn } from "@/cn";
import { terminalText } from "@/changes/terminal";
import {
  IDLE_ACTIVITY,
  RUNNING_TASK_POLL_MS,
  branchView,
  contentRows,
  contentWindow,
  featuresOf,
  instanceHead,
  lastSync,
  panelProblem,
  pollsMetabase,
  sessionBranch,
  syncButton,
  syncCount,
  syncRefusal,
  syncedItemsLine,
  syncedTreeView,
  treeProblem,
  worktreeNote,
  type ActionView,
  type BranchView,
  type ContentRow,
  type EditsLine,
  type InstanceHead,
  type LineTone,
  type SyncedTreeView,
  type TaskView,
  type TransformActivity,
  type ValidationView,
} from "@/metabase/panel";

import { FileTree } from "./Changes/FileTree";
import { FilePreviewPane } from "./FilesPanel";
import { Note } from "./Note";
import { TreeColumn } from "./TreeColumn";
import { Button, buttonVariants } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "./ui/dialog";
import { Empty, EmptyLoading, EmptyProblem } from "./ui/empty";
import { Input } from "./ui/input";
import { PlainButton } from "./ui/plain-button";
import { Progress } from "./ui/progress";
import { Spinner } from "./ui/spinner";

const DOT_CLASSES: Readonly<Record<LineTone, string>> = {
  plain: "bg-ink-3",
  quiet: "bg-ink-3",
  ok: "bg-green",
  warning: "bg-orange",
  error: "bg-red",
};

const ROW_INDENT = "pl-5.5";

interface MetabasePanelProps {
  readonly connection: ConnectionState;
  readonly snapshot: SessionSnapshot | null;
  readonly theme: Theme;
  readonly onOpenSettings: () => void;
  readonly onMention: (path: string) => void;
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// `children` is the head's one primary action.
interface HeadProps {
  readonly head: InstanceHead;
  readonly children?: ReactNode;
}

function Head({ head, children }: HeadProps): ReactElement {
  const title = head.user === null ? head.url : `${head.url}\nSigned in as ${head.user}`;
  return (
    <header
      aria-label="Metabase instance"
      className="@container flex h-9 shrink-0 items-center gap-2 pr-1.5 pl-3"
    >
      <p className="flex min-w-0 flex-1 items-baseline gap-2" title={title}>
        <span className="max-w-full shrink-0 truncate text-body font-medium text-ink">
          {head.host}
        </span>
        {head.version === null ? null : (
          <span className="hidden min-w-0 truncate text-meta text-ink-3 @md:inline">
            {head.version}
          </span>
        )}
      </p>
      <a
        href={head.url}
        target="_blank"
        rel="noreferrer"
        aria-label="Open Metabase"
        title="Open Metabase"
        className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
      >
        <ExternalLink aria-hidden />
      </a>
      {children}
    </header>
  );
}

interface ConnectionTroubleProps {
  readonly connection: ConnectionState;
  readonly onOpenSettings: () => void;
}

function ConnectionTrouble({
  connection,
  onOpenSettings,
}: ConnectionTroubleProps): ReactElement | null {
  switch (connection.kind) {
    case "disconnected":
    case "connected": {
      return null;
    }
    case "stale": {
      return (
        <div className="space-y-2 px-3 pb-3">
          <Note tone="warning">{connection.reason}</Note>
          <Button
            variant="outline"
            size="xs"
            onClick={() => {
              void rde.connectionRefresh();
            }}
          >
            Try again
          </Button>
        </div>
      );
    }
    case "signed-out": {
      return (
        <div className="space-y-2 px-3 pb-3">
          <Note tone="warning">{connection.reason}</Note>
          <Button variant="outline" size="xs" onClick={onOpenSettings}>
            Sign in again
          </Button>
        </div>
      );
    }
    default: {
      return assertNever(connection);
    }
  }
}

function headOf(connection: ConnectionState, worktree: MetabaseWorktree): InstanceHead | null {
  switch (connection.kind) {
    case "disconnected": {
      return null;
    }
    case "connected": {
      return instanceHead(connection.url, connection.server, connection.user.name, worktree);
    }
    case "stale": {
      return instanceHead(connection.url, connection.server, null, worktree);
    }
    case "signed-out": {
      return instanceHead(connection.url, null, null, worktree);
    }
    default: {
      return assertNever(connection);
    }
  }
}

interface SectionHeadProps {
  readonly label: string;
  readonly children?: ReactNode;
}

function SectionHead({ label, children }: SectionHeadProps): ReactElement {
  return (
    <div className="flex h-9 items-center gap-2 pr-1.5 pl-3">
      <h3 className="shrink-0 text-detail font-medium text-ink-2">{label}</h3>
      {children}
    </div>
  );
}

interface TaskProps {
  readonly task: TaskView;
}

function Task({ task }: TaskProps): ReactElement {
  if (task.kind === "running") {
    const done = task.percent === null ? "" : ` · ${task.percent}%`;
    return (
      <div data-sync-task="running" className="space-y-1.5">
        <p className="text-detail text-ink-2">
          {task.label}
          {done}
        </p>
        <Progress value={task.percent} label={task.label} />
      </div>
    );
  }
  return (
    <div data-sync-task={task.status} className="space-y-0.5">
      <StatusLine tone={task.tone}>{task.text}</StatusLine>
      {task.detail === null ? null : <p className="pl-3.5 text-detail text-ink-3">{task.detail}</p>}
    </div>
  );
}

interface EditsProps {
  readonly edits: EditsLine;
}

function Edits({ edits }: EditsProps): ReactElement {
  return (
    <StatusLine tone="warning">
      {edits.text} <span className="text-ink">{edits.names.join(", ")}</span>
      {edits.more === 0 ? null : `, and ${edits.more} more`}
    </StatusLine>
  );
}

interface StatusLineProps {
  readonly tone: LineTone;
  readonly children: ReactNode;
}

// One fact about the branch: a dot in its tone, and the words in the panel's quiet ink.
function StatusLine({ tone, children }: StatusLineProps): ReactElement {
  return (
    <p className="flex gap-2 text-detail text-ink-2">
      <span
        aria-hidden
        className={cn("mt-1.75 size-1.5 shrink-0 rounded-full", DOT_CLASSES[tone])}
      />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

interface TrackedProps {
  readonly view: BranchView;
}

function Tracked({ view }: TrackedProps): ReactElement {
  return (
    <p className="pl-5 text-meta text-ink-3">
      {view.tracked.lead}
      {view.tracked.branch === null ? null : (
        <>
          {" "}
          <span className="font-mono text-ink-2">{view.tracked.branch}</span>
        </>
      )}
      {view.tracked.collections === null ? null : ` · ${view.tracked.collections}`}
    </p>
  );
}

const VALIDATION_ICONS: Readonly<Record<ValidationView["kind"], ReactElement>> = {
  valid: <CircleCheck aria-label="Valid" className="size-3.5 text-green" />,
  invalid: <CircleAlert aria-label="Invalid" className="size-3.5 text-red" />,
  unchecked: <CircleDashed aria-label="Not validated" className="size-3.5 text-ink-3" />,
};

const DELETED_ICON = <CircleMinus aria-label="Deleted" className="size-3.5 text-ink-3" />;

interface ActionButtonProps {
  readonly action: ActionView;
  readonly label: string;
  readonly runningLabel: string;
  readonly icon: ReactElement;
  readonly onRun: () => void;
}

function ActionButton({
  action,
  label,
  runningLabel,
  icon,
  onRun,
}: ActionButtonProps): ReactElement {
  return (
    <Button
      variant="outline"
      size="xs"
      disabled={action.kind !== "enabled"}
      aria-label={label}
      onClick={onRun}
    >
      {icon}
      {action.kind === "running" ? runningLabel : label}
    </Button>
  );
}

function reasonsOf(run: ActionView, tests: ActionView): string[] {
  const reasons = [run, tests]
    .map((action) => (action.kind === "disabled" ? action.reason : null))
    .filter((reason) => reason !== null);
  return [...new Set(reasons)];
}

interface RowProps {
  readonly row: ContentRow;
  readonly onOpenFile: (path: string) => void;
  readonly onRun: (transformId: number) => void;
  readonly onRunTests: (transformId: number) => void;
}

function Row({ row, onOpenFile, onRun, onRunTests }: RowProps): ReactElement {
  const transform = row.transform;
  return (
    <li
      data-content-item
      data-validation={row.validation === null ? "deleted" : row.validation.kind}
      className="space-y-1 py-1 pr-1.5 pl-3"
    >
      <div className="flex min-h-7 items-center gap-2">
        <span className="shrink-0">
          {row.validation === null ? DELETED_ICON : VALIDATION_ICONS[row.validation.kind]}
        </span>
        <span className="min-w-0 flex-1 truncate text-body text-ink" title={row.path}>
          {row.name}
        </span>
        <span className="shrink-0 text-meta text-ink-3">
          {row.kind} · {row.change}
        </span>
        {row.url === null ? (
          <span aria-hidden className="size-6 shrink-0" />
        ) : (
          <a
            href={row.url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${row.name} in Metabase`}
            title="Open in Metabase"
            className={buttonVariants({ variant: "ghost", size: "icon-xs" })}
          >
            <ExternalLink aria-hidden />
          </a>
        )}
      </div>
      {row.validation === null || row.validation.lines.length === 0 ? null : (
        <div className={cn("space-y-0.5", ROW_INDENT)}>
          <ul className="space-y-0.5 text-detail text-red">
            {row.validation.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <PlainButton
            aria-label={`Open ${row.path}`}
            className="max-w-full truncate font-mono text-meta text-ink-3 hover:text-ink hover:underline"
            onClick={() => {
              onOpenFile(row.path);
            }}
          >
            {row.path}
          </PlainButton>
        </div>
      )}
      {transform === null ? null : (
        <div className={cn("space-y-1 pb-1", ROW_INDENT)}>
          <div className="flex items-center gap-1.5">
            <ActionButton
              action={transform.run}
              label="Run"
              runningLabel="Running"
              icon={<Play aria-hidden />}
              onRun={() => {
                onRun(transform.id);
              }}
            />
            <ActionButton
              action={transform.tests}
              label="Run tests"
              runningLabel="Testing"
              icon={<TestTube aria-hidden />}
              onRun={() => {
                onRunTests(transform.id);
              }}
            />
          </div>
          {reasonsOf(transform.run, transform.tests).map((reason) => (
            <div key={reason} data-action-reason>
              <StatusLine tone="quiet">{reason}</StatusLine>
            </div>
          ))}
          {transform.lastRun === null ? null : (
            <div data-last-run={transform.lastRun.status}>
              <StatusLine tone={transform.lastRun.tone}>{transform.lastRun.text}</StatusLine>
            </div>
          )}
          {transform.runRefusal === null ? null : <Note tone="error">{transform.runRefusal}</Note>}
          {transform.testsLine === null ? null : (
            <div data-tests-result>
              <StatusLine tone={transform.testsLine.tone}>{transform.testsLine.text}</StatusLine>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

interface ContentProps {
  readonly sessionId: string;
  readonly content: SessionContent | null;
  readonly failure: string | null;
  readonly features: ConnectedFeatures | null;
  readonly worktree: MetabaseWorktree;
  readonly onChanged: () => void;
}

function refusedRun(error: unknown): TransformRunOutcome {
  return { kind: "refused", message: failureMessage(error) };
}

function refusedTests(error: unknown): TransformTestsOutcome {
  return { kind: "refused", message: failureMessage(error) };
}

const CONTENT_LABEL = "Content";

function Content({
  sessionId,
  content,
  failure,
  features,
  worktree,
  onChanged,
}: ContentProps): ReactElement {
  const [activity, setActivity] = useState<ReadonlyMap<number, TransformActivity>>(new Map());
  const [openRefusal, setOpenRefusal] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const activityOf = (transformId: number): TransformActivity =>
    activity.get(transformId) ?? IDLE_ACTIVITY;

  const update = (transformId: number, change: Partial<TransformActivity>): void => {
    setActivity((current) => {
      const next = new Map(current);
      next.set(transformId, { ...(current.get(transformId) ?? IDLE_ACTIVITY), ...change });
      return next;
    });
  };

  const run = async (transformId: number): Promise<void> => {
    update(transformId, { run: { kind: "running" } });
    const outcome = await rde.metabaseRunTransform({ sessionId, transformId }).catch(refusedRun);
    update(transformId, { run: { kind: "answered", outcome } });
    onChanged();
  };

  const runTests = async (transformId: number): Promise<void> => {
    update(transformId, { tests: { kind: "running" } });
    const outcome = await rde
      .metabaseRunTransformTests({ sessionId, transformId })
      .catch(refusedTests);
    update(transformId, { tests: { kind: "answered", outcome } });
  };

  const openFile = async (path: string): Promise<void> => {
    const outcome = await rde.changesOpenFile({ sessionId, path });
    setOpenRefusal(outcome.kind === "refused" ? outcome.message : null);
  };

  if (content === null) {
    return (
      <>
        <SectionHead label={CONTENT_LABEL} />
        <div className="px-3 pb-3">
          {failure === null ? (
            <Spinner label="Reading content" />
          ) : (
            <Note tone="error">{failure}</Note>
          )}
        </div>
      </>
    );
  }
  if (content.items.length === 0) {
    return (
      <>
        <SectionHead label={CONTENT_LABEL} />
        <p className="px-3 pb-3 text-detail text-ink-3">
          This session hasn&apos;t changed any content yet.
        </p>
      </>
    );
  }
  const rows = contentRows(content.items, { features, worktree }, activityOf, new Date());
  const shown = contentWindow(rows, filter);
  return (
    <>
      <SectionHead label={CONTENT_LABEL}>
        <span className="text-meta text-ink-3">{rows.length}</span>
      </SectionHead>
      {shown.filterable ? (
        <div className="px-3 pb-1">
          <Input
            type="search"
            aria-label="Filter content"
            placeholder="Filter"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
            }}
          />
        </div>
      ) : null}
      <ul aria-label="Changed content" className="pb-2">
        {shown.rows.map((row) => (
          <Row
            key={row.path}
            row={row}
            onOpenFile={(path) => {
              void openFile(path);
            }}
            onRun={(transformId) => {
              void run(transformId);
            }}
            onRunTests={(transformId) => {
              void runTests(transformId);
            }}
          />
        ))}
      </ul>
      {shown.more === 0 ? null : (
        <p className="px-3 pb-3 text-detail text-ink-3">and {shown.more} more</p>
      )}
      {openRefusal === null ? null : (
        <div className="px-3 pb-3">
          <Note tone="error">{openRefusal}</Note>
        </div>
      )}
    </>
  );
}

interface SyncRun {
  readonly output: string;
  readonly outcome: ActionOutcome | null;
}

const SYNC_IDLE: SyncRun = { output: "", outcome: null };

interface FrameProps {
  readonly header: ReactNode;
  readonly opened: ReactNode;
  readonly tree: ReactNode;
  readonly children: ReactNode;
}

// The header spans the tab above both columns, so it stays while a file from the tree is open.
// The overview is hidden rather than unmounted then, keeping what its rows are running.
function Frame({ header, opened, tree, children }: FrameProps): ReactElement {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className={cn("min-h-0 flex-1 overflow-y-auto", opened === null ? null : "hidden")}>
            {children}
          </div>
          {opened}
        </div>
        {tree}
      </div>
    </div>
  );
}

// The connection's kind is read again with the session, so a sign-out or a lost instance
// mid-session changes what the panel says can run.
// `opened` is the pane of the file chosen in `tree`, null while the overview shows.
interface SessionMetabaseProps {
  readonly snapshot: SessionSnapshot;
  readonly connection: ConnectionState;
  readonly opened: ReactNode;
  readonly tree: ReactNode;
  readonly onOpenSettings: () => void;
}

function SessionMetabase({
  snapshot,
  connection,
  opened,
  tree,
  onOpenSettings,
}: SessionMetabaseProps): ReactElement {
  const sessionId = snapshot.session.id;
  const connectionKind = connection.kind;
  const features = featuresOf(connection);
  const [state, setState] = useState<MetabasePanelState | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [content, setContent] = useState<SessionContent | null>(null);
  const [contentFailure, setContentFailure] = useState<string | null>(null);
  const [panelRevision, setPanelRevision] = useState(0);
  const [contentRevision, setContentRevision] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [run, setRun] = useState<SyncRun>(SYNC_IDLE);
  const [confirming, setConfirming] = useState(false);
  const sessionKey = `${snapshot.session.lastCheckpointSeq}:${syncCount(snapshot)}:${connectionKind}`;

  useEffect(() => {
    rde.metabasePanel({ sessionId }).then(
      (next) => {
        setState(next);
        setFailure(null);
      },
      (error: unknown) => {
        setFailure(failureMessage(error));
      },
    );
  }, [sessionId, sessionKey, panelRevision]);

  useEffect(() => {
    rde.metabaseContent({ sessionId }).then(
      (next) => {
        setContent(next);
        setContentFailure(null);
      },
      (error: unknown) => {
        setContentFailure(failureMessage(error));
      },
    );
  }, [sessionId, sessionKey, contentRevision]);

  const polling = pollsMetabase(syncing, state === null ? null : state.remoteSync);
  useEffect(() => {
    if (!polling) {
      return undefined;
    }
    const timer = setTimeout(() => {
      setPanelRevision((current) => current + 1);
    }, RUNNING_TASK_POLL_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [polling, state]);

  useEffect(
    () =>
      rde.onSyncOutput((output) => {
        if (output.sessionId === sessionId) {
          setRun((current) => ({ ...current, output: `${current.output}${output.text}` }));
        }
      }),
    [sessionId],
  );

  const reloadPanel = useCallback((): void => {
    setPanelRevision((current) => current + 1);
  }, []);

  const reloadContent = useCallback((): void => {
    setContentRevision((current) => current + 1);
  }, []);

  const sync = async (confirmedGuard: boolean): Promise<void> => {
    setConfirming(false);
    setSyncing(true);
    setRun(SYNC_IDLE);
    const outcome = await rde
      .metabaseSync({ sessionId, confirmedGuard })
      .catch(
        (error: unknown): ActionOutcome => ({ kind: "refused", message: failureMessage(error) }),
      );
    setRun((current) => ({ ...current, outcome }));
    setSyncing(false);
    reloadPanel();
    reloadContent();
  };

  const ignore = async (): Promise<void> => {
    await rde.metabaseIgnoreAppDirectories({ sessionId });
    reloadPanel();
  };

  if (state === null) {
    const loadingHead = headOf(connection, NO_WORKTREE);
    return (
      <Frame
        header={
          loadingHead === null ? null : (
            <div className="shrink-0 border-b border-line">
              <Head head={loadingHead} />
            </div>
          )
        }
        opened={opened}
        tree={tree}
      >
        {failure === null ? (
          <EmptyLoading label="Reading Metabase" />
        ) : (
          <EmptyProblem icon={CircleAlert} {...panelProblem(failure)} />
        )}
      </Frame>
    );
  }

  const readiness = state.readiness;
  const button = syncButton(readiness, syncing, state.remoteSync);
  const branch = branchView(state.remoteSync, new Date());
  const previous = lastSync(snapshot);
  const refusal = syncRefusal(run.outcome, previous);
  const note = worktreeNote(state.worktree);
  const head = headOf(connection, state.worktree);
  const working = sessionBranch(state.worktree, readiness, snapshot.session.workspace.branch);
  const lastFailure =
    previous !== null && previous.outcome.kind === "failed"
      ? `The last sync of ${previous.branch} failed: ${previous.outcome.message}`
      : null;
  const hasRunNotes = run.output.length > 0 || refusal !== null || lastFailure !== null;

  const header = (
    <section aria-label="This branch in Metabase" className="shrink-0 border-b border-line">
      {head === null ? null : (
        <Head head={head}>
          <Button
            size="sm"
            disabled={button.disabled}
            onClick={() => {
              if (readiness.kind === "ready" && readiness.guard !== null) {
                setConfirming(true);
                return;
              }
              void sync(false);
            }}
          >
            <Upload aria-hidden />
            {button.label}
          </Button>
        </Head>
      )}
      <div className="space-y-1.5 px-3 pb-2.5">
        <div className="space-y-0.5">
          <p className="flex min-w-0 items-center gap-1.5">
            <GitBranch aria-hidden className="size-3.5 shrink-0 text-ink-3" />
            <span className="truncate font-mono text-detail text-ink">{working.label}</span>
            {working.worktree === null ? null : (
              <span className="shrink-0 text-meta text-ink-3">{working.worktree}</span>
            )}
          </p>
          {branch === null ? null : <Tracked view={branch} />}
        </div>
        {branch === null || branch.task === null ? null : <Task task={branch.task} />}
        {readiness.kind === "ready" ? null : (
          <p data-sync-blocked className="text-detail text-ink-3">
            {readiness.reason}
          </p>
        )}
        {note === null ? null : <StatusLine tone="quiet">{note}</StatusLine>}
        {state.remoteSync.kind === "unavailable" ? (
          <StatusLine tone="warning">{state.remoteSync.message}</StatusLine>
        ) : null}
        {branch === null || branch.edits === null ? null : <Edits edits={branch.edits} />}
        {branch === null || branch.remote === null ? null : (
          <div data-remote-changes>
            <StatusLine tone={branch.remote.tone}>{branch.remote.text}</StatusLine>
          </div>
        )}
      </div>
      <ConnectionTrouble connection={connection} onOpenSettings={onOpenSettings} />
    </section>
  );

  return (
    <Frame header={header} opened={opened} tree={tree}>
      {hasRunNotes ? (
        <section aria-label="The last sync" className="space-y-2 border-b border-line px-3 py-3">
          {run.output.length === 0 ? null : (
            <pre
              aria-label="Sync output"
              className="max-h-48 overflow-auto rounded-chip bg-inset p-2 font-mono text-detail whitespace-pre-wrap text-ink-2"
            >
              {terminalText(run.output)}
            </pre>
          )}
          {refusal === null ? null : <Note tone="error">{refusal}</Note>}
          {lastFailure === null ? null : <Note tone="error">{lastFailure}</Note>}
        </section>
      ) : null}
      <section aria-label="This session's content" className="border-b border-line">
        <Content
          key={sessionId}
          sessionId={sessionId}
          content={content}
          failure={contentFailure}
          features={features}
          worktree={state.worktree}
          onChanged={reloadContent}
        />
      </section>
      {state.unignored.length === 0 ? null : (
        <section aria-label="Ignored files" className="space-y-2 p-3">
          <StatusLine tone="warning">
            {state.unignored.join(" and ")} isn&apos;t ignored, so it would land on the branch.
          </StatusLine>
          <Button
            variant="outline"
            size="xs"
            className="ml-3.5"
            onClick={() => {
              void ignore();
            }}
          >
            <EyeOff aria-hidden />
            Add to .gitignore
          </Button>
        </section>
      )}
      <Dialog
        open={confirming}
        onOpenChange={(next) => {
          if (!next) {
            setConfirming(false);
          }
        }}
      >
        <DialogContent>
          <DialogTitle>Import the tracked branch?</DialogTitle>
          <DialogDescription>
            {readiness.kind === "ready" && readiness.guard !== null ? readiness.guard : null}
          </DialogDescription>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                void sync(true);
              }}
            >
              Import anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Frame>
  );
}

interface TreeLoading {
  readonly kind: "loading";
}

interface TreeLoaded {
  readonly kind: "loaded";
  readonly tree: SyncedTree;
}

interface TreeFailed {
  readonly kind: "failed";
  readonly message: string;
}

type TreeState = TreeLoading | TreeLoaded | TreeFailed;

const TREE_LOADING: TreeLoading = { kind: "loading" };
const TREE_LABEL = "Synced content";

// `path` is the checkout file the item opens, null when the branch holds none.
interface OpenedItem {
  readonly treePath: string;
  readonly path: string | null;
}

interface TreeHeadProps {
  readonly view: SyncedTreeView | null;
  readonly onOverview: () => void;
  readonly onRefresh: () => void;
}

function TreeHead({ view, onOverview, onRefresh }: TreeHeadProps): ReactElement {
  return (
    <div className="flex min-h-9 shrink-0 items-center gap-1 border-b border-line pr-1.5 pl-3">
      <div className="min-w-0 flex-1">
        <TreeSummary view={view} />
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Show this branch in Metabase"
        title="This branch in Metabase"
        onClick={onOverview}
      >
        <LayoutList aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Refresh synced content"
        title="Refresh"
        onClick={onRefresh}
      >
        <RefreshCw aria-hidden />
      </Button>
    </div>
  );
}

interface TreeSummaryProps {
  readonly view: SyncedTreeView | null;
}

function TreeSummary({ view }: TreeSummaryProps): ReactElement | null {
  const line = view === null ? null : syncedItemsLine(view);
  return line === null ? null : <p className="truncate text-meta text-ink-2">{line}</p>;
}

interface TreeBodyProps {
  readonly tree: TreeState;
  readonly view: SyncedTreeView | null;
  readonly selected: string | null;
  readonly onSelect: (treePath: string) => void;
}

function TreeBody({ tree, view, selected, onSelect }: TreeBodyProps): ReactElement | null {
  if (tree.kind === "loading") {
    return <EmptyLoading label="Reading Metabase" />;
  }
  if (tree.kind === "loaded" && tree.tree.kind === "off") {
    return <Empty icon={CloudOff} label="Remote sync is off" />;
  }
  const problem = problemOf(tree);
  if (problem !== null) {
    return <EmptyProblem icon={CircleAlert} {...treeProblem(problem)} />;
  }
  if (view === null) {
    return null;
  }
  if (view.paths.length === 0) {
    return <Empty icon={FolderOpen} label="Nothing synced" />;
  }
  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <FileTree
        label={TREE_LABEL}
        ground="canvas"
        paths={view.paths}
        changes={NO_CHANGES}
        selected={selected}
        onSelect={onSelect}
      />
    </div>
  );
}

const NO_CHANGES: readonly DiffFile[] = [];
const NO_WORKTREE: MetabaseWorktree = { kind: "absent" };

function problemOf(tree: TreeState): string | null {
  if (tree.kind === "failed") {
    return tree.message;
  }
  return tree.kind === "loaded" && tree.tree.kind === "unavailable" ? tree.tree.message : null;
}

function viewOf(tree: TreeState): SyncedTreeView | null {
  return tree.kind === "loaded" && tree.tree.kind === "read"
    ? syncedTreeView(tree.tree.collections)
    : null;
}

interface SessionPanelProps {
  readonly connection: ConnectionState;
  readonly snapshot: SessionSnapshot;
  readonly theme: Theme;
  readonly onOpenSettings: () => void;
  readonly onMention: (path: string) => void;
}

// The synced content is read when the tab opens, when a sync lands and on refresh, never on the
// panel's own poll: listing it runs the CLI against the instance and reads every content file.
function SessionPanel({
  connection,
  snapshot,
  theme,
  onOpenSettings,
  onMention,
}: SessionPanelProps): ReactElement {
  const sessionId = snapshot.session.id;
  const [revision, setRevision] = useState(0);
  const [tree, setTree] = useState<TreeState>(TREE_LOADING);
  const [opened, setOpened] = useState<OpenedItem | null>(null);
  const treeKey = `${syncCount(snapshot)}:${connection.kind}:${revision}`;

  useEffect(() => {
    rde.metabaseTree({ sessionId }).then(
      (loaded) => {
        setTree({ kind: "loaded", tree: loaded });
      },
      (error: unknown) => {
        setTree({ kind: "failed", message: failureMessage(error) });
      },
    );
  }, [sessionId, treeKey]);

  const view = useMemo(() => viewOf(tree), [tree]);

  const select = (treePath: string): void => {
    const path = view?.files.get(treePath);
    if (path !== undefined) {
      setOpened({ treePath, path });
    }
  };

  return (
    <SessionMetabase
      snapshot={snapshot}
      connection={connection}
      onOpenSettings={onOpenSettings}
      opened={
        opened === null ? null : (
          <OpenedPane
            sessionId={sessionId}
            opened={opened}
            refreshKey={String(snapshot.session.lastCheckpointSeq)}
            theme={theme}
            onMention={onMention}
          />
        )
      }
      tree={
        <TreeColumn>
          <TreeHead
            view={view}
            onOverview={() => {
              setOpened(null);
            }}
            onRefresh={() => {
              setRevision((current) => current + 1);
            }}
          />
          <TreeBody
            tree={tree}
            view={view}
            selected={opened === null ? null : opened.treePath}
            onSelect={select}
          />
        </TreeColumn>
      }
    />
  );
}

interface OpenedPaneProps {
  readonly sessionId: string;
  readonly opened: OpenedItem;
  readonly refreshKey: string;
  readonly theme: Theme;
  readonly onMention: (path: string) => void;
}

function OpenedPane({
  sessionId,
  opened,
  refreshKey,
  theme,
  onMention,
}: OpenedPaneProps): ReactElement {
  if (opened.path === null) {
    return <Empty icon={FileX} label="Not in this branch" />;
  }
  return (
    <FilePreviewPane
      sessionId={sessionId}
      path={opened.path}
      refreshKey={refreshKey}
      theme={theme}
      onMention={onMention}
    />
  );
}

export function MetabasePanel({
  connection,
  snapshot,
  theme,
  onOpenSettings,
  onMention,
}: MetabasePanelProps): ReactElement {
  const head = headOf(connection, NO_WORKTREE);
  if (head === null) {
    return (
      <Empty icon={CloudOff} label="Not connected">
        <Button variant="outline" size="sm" onClick={onOpenSettings}>
          Connect to Metabase
        </Button>
      </Empty>
    );
  }
  if (snapshot === null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-line">
          <Head head={head} />
          <ConnectionTrouble connection={connection} onOpenSettings={onOpenSettings} />
        </div>
      </div>
    );
  }
  return (
    <SessionPanel
      key={snapshot.session.id}
      connection={connection}
      snapshot={snapshot}
      theme={theme}
      onOpenSettings={onOpenSettings}
      onMention={onMention}
    />
  );
}
