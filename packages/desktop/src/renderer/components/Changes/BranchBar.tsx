import { Ellipsis, ExternalLink, GitBranch, GitCommitHorizontal, Upload } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from "react";

import type { ActionOutcome, BranchStatus, PushMode } from "../../../contracts/changes";
import { assertNever } from "../../../contracts/assert-never";
import { rde } from "@/bridge";
import { terminalText } from "@/changes/terminal";
import {
  branchActions,
  branchLabel,
  baseMovedNote,
  syncLine,
  type BranchAction,
} from "@/changes/branch";

import { Note } from "../Note";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../ui/menu";

const MORE_ACTIONS_LABEL = "More branch actions";

interface ActionLook {
  readonly label: string;
  readonly icon: LucideIcon;
}

const ACTION_LOOKS: Readonly<Record<BranchAction, ActionLook>> = {
  commit: { label: "Commit", icon: GitCommitHorizontal },
  push: { label: "Push", icon: Upload },
  "pull-request": { label: "Open pull request", icon: ExternalLink },
};

interface BranchBarProps {
  readonly sessionId: string;
  readonly title: string;
  readonly refreshKey: string;
  readonly onChanged: () => void;
  readonly view: ReactNode;
}

interface PushRun {
  readonly output: string;
  readonly outcome: ActionOutcome | null;
}

const PUSH_IDLE: PushRun = { output: "", outcome: null };

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface BranchLineProps {
  readonly status: BranchStatus;
}

function BranchLine({ status }: BranchLineProps): ReactElement {
  const branch = branchLabel(status);
  const sync = syncLine(status);
  // The state beside the branch decides what can be done next, so the name gives way first; the
  // full name stays on hover.
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-meta text-ink-3">
      <GitBranch aria-hidden className="size-3.5 shrink-0" />
      <span data-branch title={branch} className="min-w-16 truncate font-mono text-ink-2">
        {branch}
      </span>
      <span aria-hidden>·</span>
      <span data-sync title={sync} className="max-w-3/4 shrink-0 truncate">
        {sync}
      </span>
    </p>
  );
}

export function BranchBar({
  sessionId,
  title,
  refreshKey,
  onChanged,
  view,
}: BranchBarProps): ReactElement {
  const [status, setStatus] = useState<BranchStatus | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);

  const load = useCallback((): void => {
    rde.branchStatus({ sessionId }).then(
      (next) => {
        setStatus(next);
        setFailure(null);
      },
      (error: unknown) => {
        setFailure(failureMessage(error));
      },
    );
  }, [sessionId]);

  useEffect(load, [load, refreshKey]);

  const openPullRequest = async (): Promise<void> => {
    const outcome = await rde.branchOpenPullRequest({ sessionId });
    setFailure(outcome.kind === "refused" ? outcome.message : null);
  };

  if (status === null) {
    return (
      <div className="flex flex-col gap-3">
        {failure === null ? (
          <Spinner label="Reading the branch" />
        ) : (
          <Note tone="error">{failure}</Note>
        )}
        <div className="flex items-center gap-2">{view}</div>
      </div>
    );
  }

  const run = (action: BranchAction): void => {
    switch (action) {
      case "commit": {
        setCommitting(true);
        return;
      }
      case "push": {
        setPushing(true);
        return;
      }
      case "pull-request": {
        void openPullRequest();
        return;
      }
      default: {
        assertNever(action);
      }
    }
  };

  const baseMoved = baseMovedNote(status);
  const offered = branchActions(status);
  const primary = offered.primary;
  return (
    <div className="flex flex-col gap-3">
      <BranchLine status={status} />
      {baseMoved === null ? null : <Note tone="warning">{baseMoved}</Note>}
      {failure === null ? null : <Note tone="error">{failure}</Note>}
      <div className="flex items-center gap-2">
        {view}
        <div className="ml-auto flex items-center gap-1">
          {primary === null ? null : (
            <PrimaryAction
              action={primary}
              onRun={() => {
                run(primary);
              }}
            />
          )}
          <Menu>
            <MenuTrigger
              render={<Button variant="ghost" size="icon-sm" aria-label={MORE_ACTIONS_LABEL} />}
            >
              <Ellipsis aria-hidden />
            </MenuTrigger>
            <MenuContent>
              {offered.more.map((entry) => {
                const look = ACTION_LOOKS[entry.action];
                const Icon = look.icon;
                return (
                  <MenuItem
                    key={entry.action}
                    disabled={entry.blocker !== null}
                    onClick={() => {
                      run(entry.action);
                    }}
                  >
                    <Icon aria-hidden />
                    <span className="grid gap-0.5">
                      <span>{look.label}</span>
                      {entry.blocker === null ? null : (
                        <span className="text-meta text-ink-3">{entry.blocker}</span>
                      )}
                    </span>
                  </MenuItem>
                );
              })}
            </MenuContent>
          </Menu>
        </div>
      </div>
      <CommitDialog
        open={committing}
        sessionId={sessionId}
        title={title}
        onClose={() => {
          setCommitting(false);
        }}
        onCommitted={() => {
          setCommitting(false);
          load();
          onChanged();
        }}
      />
      <PushDialog
        open={pushing}
        sessionId={sessionId}
        branch={branchLabel(status)}
        canForce={status.ownBranch}
        onClose={() => {
          setPushing(false);
          load();
        }}
      />
    </div>
  );
}

interface PrimaryActionProps {
  readonly action: BranchAction;
  readonly onRun: () => void;
}

function PrimaryAction({ action, onRun }: PrimaryActionProps): ReactElement {
  const look = ACTION_LOOKS[action];
  const Icon = look.icon;
  return (
    <Button size="sm" data-primary-action={action} onClick={onRun}>
      <Icon aria-hidden />
      {look.label}
    </Button>
  );
}

interface CommitDialogProps {
  readonly open: boolean;
  readonly sessionId: string;
  readonly title: string;
  readonly onClose: () => void;
  readonly onCommitted: () => void;
}

function CommitDialog({
  open,
  sessionId,
  title,
  onClose,
  onCommitted,
}: CommitDialogProps): ReactElement {
  const [message, setMessage] = useState(title);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setMessage(title);
      setRefusal(null);
    }
  }, [open, title]);

  const commit = async (): Promise<void> => {
    setBusy(true);
    const outcome = await rde.branchCommit({ sessionId, message });
    setBusy(false);
    if (outcome.kind === "refused") {
      setRefusal(outcome.message);
      return;
    }
    onCommitted();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogTitle>Commit all changes</DialogTitle>
        <div className="grid gap-1.5">
          <Label htmlFor="commit-message">Message</Label>
          <Input
            id="commit-message"
            value={message}
            onChange={(event) => {
              setMessage(event.target.value);
            }}
          />
        </div>
        {refusal === null ? null : <Note tone="error">{refusal}</Note>}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={busy || message.trim().length === 0}
            onClick={() => {
              void commit();
            }}
          >
            Commit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface PushDialogProps {
  readonly open: boolean;
  readonly sessionId: string;
  readonly branch: string;
  readonly canForce: boolean;
  readonly onClose: () => void;
}

// A rejection offers a force-with-lease only for a branch the app created.
function PushDialog({ open, sessionId, branch, canForce, onClose }: PushDialogProps): ReactElement {
  const [run, setRun] = useState<PushRun>(PUSH_IDLE);
  const running = open && run.outcome === null;

  const push = useCallback(
    (mode: PushMode): void => {
      setRun(PUSH_IDLE);
      void rde.branchPush({ sessionId, mode }).then(
        (outcome) => {
          setRun((current) => ({ ...current, outcome }));
        },
        (error: unknown) => {
          setRun((current) => ({
            ...current,
            outcome: { kind: "refused", message: failureMessage(error) },
          }));
        },
      );
    },
    [sessionId],
  );

  useEffect(
    () =>
      rde.onPushOutput((output) => {
        if (output.sessionId === sessionId) {
          setRun((current) => ({ ...current, output: `${current.output}${output.text}` }));
        }
      }),
    [sessionId],
  );

  useEffect(() => {
    if (open) {
      push("plain");
    }
  }, [open, push]);

  const outcome = run.outcome;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !running) {
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogTitle>Push {branch}</DialogTitle>
        <DialogDescription>
          {running ? "Pushing to origin." : null}
          {outcome?.kind === "done" ? "Pushed to origin." : null}
          {outcome?.kind === "refused" ? "origin refused the push." : null}
        </DialogDescription>
        <pre
          aria-label="Push output"
          className="max-h-48 min-h-12 overflow-auto rounded-chip bg-inset p-2 font-mono text-detail whitespace-pre-wrap text-ink-2"
        >
          {terminalText(run.output)}
        </pre>
        {outcome?.kind === "refused" ? <Note tone="error">{outcome.message}</Note> : null}
        <DialogFooter>
          {outcome?.kind === "refused" && canForce ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                push("force-with-lease");
              }}
            >
              Force with lease
            </Button>
          ) : null}
          <Button size="sm" disabled={running} onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
