import { AtSign, FileText, FolderOpen, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, type ReactElement } from "react";

import { assertNever } from "../../contracts/assert-never";
import type { FilePreview, SessionTree } from "../../contracts/files";
import type { SessionSnapshot } from "../../contracts/session";
import type { Theme } from "../../contracts/settings";
import { rde } from "@/bridge";
import { previewNote } from "@/file-preview";

import { CopyButton } from "./agent/CopyButton";
import { FileViewer } from "./Changes/DiffViewer";
import { FileTree } from "./Changes/FileTree";
import { Note } from "./Note";
import { TreeColumn } from "./TreeColumn";
import { Button } from "./ui/button";
import { Empty, EmptyLoading } from "./ui/empty";

const TREE_LABEL = "Session files";

interface TreeLoading {
  readonly kind: "loading";
}

interface TreeLoaded {
  readonly kind: "loaded";
  readonly tree: SessionTree;
}

interface TreeFailed {
  readonly kind: "failed";
  readonly message: string;
}

type TreeState = TreeLoading | TreeLoaded | TreeFailed;

interface PreviewLoading {
  readonly kind: "loading";
}

// `version` is the read that produced the preview, so a second read of the same file redraws.
interface PreviewLoaded {
  readonly kind: "loaded";
  readonly preview: FilePreview;
  readonly version: number;
}

interface PreviewFailed {
  readonly kind: "failed";
  readonly message: string;
}

type PreviewState = PreviewLoading | PreviewLoaded | PreviewFailed;

const TREE_LOADING: TreeLoading = { kind: "loading" };
const PREVIEW_LOADING: PreviewLoading = { kind: "loading" };

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function folderOf(path: string): string {
  return path.slice(0, Math.max(path.lastIndexOf("/"), 0));
}

interface FilesPanelProps {
  readonly snapshot: SessionSnapshot;
  readonly theme: Theme;
  readonly onMention: (path: string) => void;
}

export function FilesPanel({ snapshot, theme, onMention }: FilesPanelProps): ReactElement {
  const sessionId = snapshot.session.id;
  const [revision, setRevision] = useState(0);
  const [tree, setTree] = useState<TreeState>(TREE_LOADING);
  const [selected, setSelected] = useState<string | null>(null);
  const refreshKey = `${snapshot.session.lastCheckpointSeq}:${revision}`;

  useEffect(() => {
    rde.filesTree({ sessionId }).then(
      (loaded) => {
        setTree({ kind: "loaded", tree: loaded });
      },
      (error: unknown) => {
        setTree({ kind: "failed", message: failureMessage(error) });
      },
    );
  }, [sessionId, refreshKey]);

  const refresh = (): void => {
    setRevision((current) => current + 1);
  };

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        {selected === null ? (
          <Empty icon={FileText} label="No file open" />
        ) : (
          <FilePreviewPane
            sessionId={sessionId}
            path={selected}
            refreshKey={refreshKey}
            theme={theme}
            onMention={onMention}
          />
        )}
      </div>
      <TreeColumn>
        <TreeHead tree={tree} onRefresh={refresh} />
        <TreeBody tree={tree} selected={selected} onSelect={setSelected} />
      </TreeColumn>
    </div>
  );
}

interface TreeBodyProps {
  readonly tree: TreeState;
  readonly selected: string | null;
  readonly onSelect: (path: string) => void;
}

function TreeBody({ tree, selected, onSelect }: TreeBodyProps): ReactElement | null {
  switch (tree.kind) {
    case "loading": {
      return <EmptyLoading label="Reading the files" />;
    }
    case "failed": {
      return null;
    }
    case "loaded": {
      if (tree.tree.paths.length === 0) {
        return <Empty icon={FolderOpen} label="No files" />;
      }
      return (
        <div className="min-h-0 flex-1 overflow-hidden">
          <FileTree
            label={TREE_LABEL}
            ground="canvas"
            paths={tree.tree.paths}
            changes={tree.tree.changed}
            selected={selected}
            onSelect={onSelect}
          />
        </div>
      );
    }
    default: {
      return assertNever(tree);
    }
  }
}

interface TreeHeadProps {
  readonly tree: TreeState;
  readonly onRefresh: () => void;
}

function TreeHead({ tree, onRefresh }: TreeHeadProps): ReactElement {
  return (
    <div className="flex min-h-9 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-3">
      <div className="min-w-0 flex-1">
        <TreeSummary tree={tree} />
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Refresh files"
        title="Refresh"
        onClick={onRefresh}
      >
        <RefreshCw aria-hidden />
      </Button>
    </div>
  );
}

interface TreeSummaryProps {
  readonly tree: TreeState;
}

function TreeSummary({ tree }: TreeSummaryProps): ReactElement | null {
  switch (tree.kind) {
    case "loading": {
      return null;
    }
    case "failed": {
      return <Note tone="error">{tree.message}</Note>;
    }
    case "loaded": {
      const count = tree.tree.paths.length;
      if (count === 0) {
        return null;
      }
      const noun = count === 1 ? "file" : "files";
      return (
        <p className="truncate text-meta text-ink-2">
          {tree.tree.truncated ? `The first ${count} ${noun}` : `${count} ${noun}`}
        </p>
      );
    }
    default: {
      return assertNever(tree);
    }
  }
}

interface FilePreviewPaneProps {
  readonly sessionId: string;
  readonly path: string;
  readonly refreshKey: string;
  readonly theme: Theme;
  readonly onMention: (path: string) => void;
}

export function FilePreviewPane({
  sessionId,
  path,
  refreshKey,
  theme,
  onMention,
}: FilePreviewPaneProps): ReactElement {
  const [state, setState] = useState<PreviewState>(PREVIEW_LOADING);
  const [refusal, setRefusal] = useState<string | null>(null);
  const latestRead = useRef(0);

  useEffect(() => {
    const read = latestRead.current + 1;
    latestRead.current = read;
    setRefusal(null);
    rde.filesPreview({ sessionId, path }).then(
      (preview) => {
        if (latestRead.current === read) {
          setState({ kind: "loaded", preview, version: read });
        }
      },
      (error: unknown) => {
        if (latestRead.current === read) {
          setState({ kind: "failed", message: failureMessage(error) });
        }
      },
    );
  }, [sessionId, path, refreshKey]);

  const openFile = async (): Promise<void> => {
    const outcome = await rde.changesOpenFile({ sessionId, path });
    setRefusal(outcome.kind === "refused" ? outcome.message : null);
  };

  const folder = folderOf(path);

  return (
    <section aria-label={`Preview of ${path}`} className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-9 shrink-0 items-center gap-1 border-b border-line pr-1.5 pl-3">
        <p className="flex min-w-0 flex-1 items-baseline gap-2" title={path}>
          <span className="shrink-0 font-mono text-detail text-ink">{fileName(path)}</span>
          {folder.length === 0 ? null : (
            <span className="truncate text-meta text-ink-3">{folder}</span>
          )}
        </p>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Mention ${path}`}
          title="Mention in the composer"
          onClick={() => {
            onMention(path);
          }}
        >
          <AtSign aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Open ${path}`}
          title="Open in your editor"
          onClick={() => {
            void openFile();
          }}
        >
          <FileText aria-hidden />
        </Button>
        <CopyButton text={path} showLabel={false} />
      </header>
      {refusal === null ? null : (
        <div className="shrink-0 px-3 py-2">
          <Note tone="error">{refusal}</Note>
        </div>
      )}
      <PreviewBody state={state} theme={theme} />
    </section>
  );
}

interface PreviewBodyProps {
  readonly state: PreviewState;
  readonly theme: Theme;
}

function PreviewBody({ state, theme }: PreviewBodyProps): ReactElement {
  switch (state.kind) {
    case "loading": {
      return <EmptyLoading label="Reading the file" />;
    }
    case "failed": {
      return (
        <div className="p-3">
          <Note tone="error">{state.message}</Note>
        </div>
      );
    }
    case "loaded": {
      const preview = state.preview;
      if (preview.kind === "text") {
        return (
          <FileViewer
            path={preview.path}
            text={preview.text}
            version={state.version}
            theme={theme}
          />
        );
      }
      return (
        <div className="p-3">
          <Note tone="info">{previewNote(preview)}</Note>
        </div>
      );
    }
    default: {
      return assertNever(state);
    }
  }
}
