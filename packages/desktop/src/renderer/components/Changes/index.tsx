import { FileDiff, FileText, RotateCcw, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";

import type { ChangeScope, ChangeSet, DiffContext, DiffFile } from "../../../contracts/changes";
import type { SessionIndexEntry, SessionSnapshot } from "../../../contracts/session";
import type { Theme } from "../../../contracts/settings";
import { rde } from "@/bridge";
import { changeTotals, changeWord, fileNamed, totalsLine } from "@/changes/files";
import { liveScope, restoreTarget, turnScopes } from "@/changes/scopes";

import { CopyButton } from "../agent/CopyButton";
import { Note } from "../Note";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "../ui/dialog";
import { Empty, EmptyLoading } from "../ui/empty";
import { Menu, MenuCheckboxItem, MenuContent, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Select } from "../ui/select";

import { BranchBar } from "./BranchBar";
import { DiffViewer, type DiffStyle } from "./DiffViewer";
import { FileTree } from "./FileTree";

const ALL_SCOPE: ChangeScope = { kind: "all" };
const NO_FILES: readonly DiffFile[] = [];
const ALL_VALUE = "all";

const DIFF_OPTIONS_LABEL = "Diff options";

interface ChangesPanelProps {
  readonly snapshot: SessionSnapshot;
  readonly sessions: readonly SessionIndexEntry[];
  readonly theme: Theme;
}

// `version` is the read that produced the set, so a file whose diff changed between reads redraws.
interface ChangesLoaded {
  readonly set: ChangeSet;
  readonly scope: ChangeScope;
  readonly version: number;
}

// Two sessions in one checkout write to the same files, so neither one's diff is only its own.
function sharedWith(snapshot: SessionSnapshot, sessions: readonly SessionIndexEntry[]): number {
  return sessions.filter(
    (entry) =>
      entry.id !== snapshot.session.id &&
      entry.lifecycle === "active" &&
      entry.workspace.path === snapshot.session.workspace.path,
  ).length;
}

function scopeValue(scope: ChangeScope): string {
  return scope.kind === "all" ? ALL_VALUE : scope.turnId;
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ChangesPanel({ snapshot, sessions, theme }: ChangesPanelProps): ReactElement {
  const sessionId = snapshot.session.id;
  const [chosenScope, setChosenScope] = useState<ChangeScope>(ALL_SCOPE);
  const [style, setStyle] = useState<DiffStyle>("unified");
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [context, setContext] = useState<DiffContext>("hunks");
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<ChangesLoaded | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [reveal, setReveal] = useState<string | null>(null);
  const [reverting, setReverting] = useState<DiffFile | null>(null);
  const latestRequest = useRef(0);

  const scope = liveScope(snapshot, chosenScope);
  const scopeKey = scopeValue(scope);
  const refreshKey = `${snapshot.session.lastCheckpointSeq}:${revision}`;

  useEffect(() => {
    const request = latestRequest.current + 1;
    latestRequest.current = request;
    const asked = scopeKey === ALL_VALUE ? ALL_SCOPE : { kind: "turn" as const, turnId: scopeKey };
    rde.changesRead({ sessionId, scope: asked, ignoreWhitespace, context }).then(
      (set) => {
        if (latestRequest.current === request) {
          setLoaded({ set, scope: asked, version: request });
          setFailure(null);
        }
      },
      (error: unknown) => {
        if (latestRequest.current === request) {
          setFailure(failureMessage(error));
        }
      },
    );
  }, [sessionId, scopeKey, ignoreWhitespace, context, refreshKey]);

  const changed = useCallback((): void => {
    setRevision((current) => current + 1);
  }, []);

  const openFile = async (path: string): Promise<void> => {
    const outcome = await rde.changesOpenFile({ sessionId, path });
    setFailure(outcome.kind === "refused" ? outcome.message : null);
  };

  const files = loaded === null ? NO_FILES : loaded.set.files;
  const paths = useMemo(() => files.map((file) => file.path), [files]);
  const shared = sharedWith(snapshot, sessions);
  const totals = changeTotals(files);

  const renderActions = (path: string): ReactElement | null => {
    const file = fileNamed(files, path);
    if (file === null) {
      return null;
    }
    return (
      <span className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Open ${path}`}
          title="Open in your editor"
          disabled={file.change === "deleted"}
          onClick={() => {
            void openFile(path);
          }}
        >
          <FileText aria-hidden />
        </Button>
        <CopyButton text={path} showLabel={false} />
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Revert ${path}`}
          title="Revert this file"
          onClick={() => {
            setReverting(file);
          }}
        >
          <RotateCcw aria-hidden />
        </Button>
      </span>
    );
  };

  const turnSelect = (
    <Select
      aria-label="Turn"
      className="w-auto"
      value={scopeKey}
      onChange={(event) => {
        const value = event.target.value;
        setChosenScope(value === ALL_VALUE ? ALL_SCOPE : { kind: "turn", turnId: value });
      }}
    >
      <option value={ALL_VALUE}>All turns</option>
      {turnScopes(snapshot).map((turn) => (
        <option key={turn.turnId} value={turn.turnId}>
          {turn.label}
        </option>
      ))}
    </Select>
  );

  const diffOptions = (
    <Menu>
      <MenuTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={DIFF_OPTIONS_LABEL} />}
      >
        <SlidersHorizontal aria-hidden />
      </MenuTrigger>
      <MenuContent align="start">
        <MenuCheckboxItem
          checked={style === "split"}
          onCheckedChange={(checked) => {
            setStyle(checked ? "split" : "unified");
          }}
        >
          Side by side
        </MenuCheckboxItem>
        <MenuSeparator />
        <MenuCheckboxItem checked={ignoreWhitespace} onCheckedChange={setIgnoreWhitespace}>
          Hide whitespace
        </MenuCheckboxItem>
        <MenuCheckboxItem
          checked={context === "file"}
          onCheckedChange={(checked) => {
            setContext(checked ? "file" : "hunks");
          }}
        >
          Whole files
        </MenuCheckboxItem>
      </MenuContent>
    </Menu>
  );

  if (loaded === null && failure !== null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <Note tone="error">{failure}</Note>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <BranchBar
        sessionId={sessionId}
        title={snapshot.session.title}
        refreshKey={refreshKey}
        onChanged={changed}
        view={
          <>
            {turnSelect}
            {diffOptions}
          </>
        }
      />
      {shared === 0 ? null : (
        <Note tone="warning">
          {shared === 1
            ? "Another session works in this checkout"
            : `${shared} other sessions work in this checkout`}
          , so the changes below mix.
        </Note>
      )}
      {failure === null ? null : <Note tone="error">{failure}</Note>}
      {loaded === null ? (
        <EmptyLoading label="Reading the changes" />
      ) : (
        <>
          {files.length === 0 ? (
            <Empty icon={FileDiff} label="No changes" />
          ) : (
            <>
              <p className="flex items-center gap-2 text-meta text-ink-2">
                <span>{totalsLine(totals)}</span>
                <span className="text-green">+{totals.added}</span>
                <span className="text-red">−{totals.removed}</span>
              </p>
              <div className="h-40 shrink-0 overflow-hidden rounded-chip bg-surface shadow-hairline">
                <FileTree
                  label="Changed files"
                  ground="surface"
                  paths={paths}
                  changes={files}
                  selected={reveal}
                  onSelect={setReveal}
                />
              </div>
              <DiffViewer
                patch={loaded.set.patch}
                version={loaded.version}
                style={style}
                theme={theme}
                reveal={reveal}
                renderActions={renderActions}
              />
            </>
          )}
          <RevertDialog
            file={reverting}
            sessionId={sessionId}
            from={loaded.set.from}
            target={restoreTarget(snapshot, loaded.scope)}
            onClose={() => {
              setReverting(null);
            }}
            onReverted={() => {
              setReverting(null);
              changed();
            }}
          />
        </>
      )}
    </div>
  );
}

interface RevertDialogProps {
  readonly file: DiffFile | null;
  readonly sessionId: string;
  readonly from: string;
  readonly target: string;
  readonly onClose: () => void;
  readonly onReverted: () => void;
}

function RevertDialog({
  file,
  sessionId,
  from,
  target,
  onClose,
  onReverted,
}: RevertDialogProps): ReactElement {
  const [refusal, setRefusal] = useState<string | null>(null);

  const revert = async (chosen: DiffFile): Promise<void> => {
    const outcome = await rde.changesRevert({
      sessionId,
      ref: from,
      path: chosen.path,
      previousPath: chosen.previousPath,
    });
    if (outcome.kind === "refused") {
      setRefusal(outcome.message);
      return;
    }
    setRefusal(null);
    onReverted();
  };

  return (
    <Dialog
      open={file !== null}
      onOpenChange={(open) => {
        if (!open) {
          setRefusal(null);
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogTitle>Revert {file === null ? null : file.path}?</DialogTitle>
        <DialogDescription>
          {file === null ? null : `${changeWord(file.change)} in this view. `}
          The file goes back to {target}, from checkpoint{" "}
          <span className="font-mono text-detail">{from}</span>.
        </DialogDescription>
        {refusal === null ? null : <Note tone="error">{refusal}</Note>}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              if (file !== null) {
                void revert(file);
              }
            }}
          >
            Revert file
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
