import { parsePatchFiles, type CodeViewItem, type FileDiffMetadata } from "@pierre/diffs";
import {
  CodeView,
  WorkerPoolContextProvider,
  type CodeViewHandle,
  type WorkerInitializationRenderOptions,
  type WorkerPoolOptions,
} from "@pierre/diffs/react";
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker";
import { useEffect, useMemo, useRef, type ReactElement, type ReactNode } from "react";

import type { Theme } from "../../../contracts/settings";
import { cn } from "@/cn";
import { SETTLES_ON_RESIZE } from "@/panels";

import "./changes.css";

export type DiffStyle = "unified" | "split";

type CodeItem = CodeViewItem<undefined>;

const THEMES = { light: "pierre-light", dark: "pierre-dark" } as const;

const PRELOADED_LANGUAGES = ["yaml", "sql", "python", "markdown", "json"];

const WORKER_POOL_SIZE = 2;

// The JS regex engine keeps the page free of WebAssembly, which its CSP does not allow; a very long
// line is left plain rather than risking the engine's backtracking on it.
const TOKENIZE_MAX_LINE_LENGTH = 1000;

const POOL_OPTIONS: WorkerPoolOptions = {
  workerFactory: () => new DiffsWorker(),
  poolSize: WORKER_POOL_SIZE,
};

const HIGHLIGHTER_OPTIONS: WorkerInitializationRenderOptions = {
  theme: THEMES,
  langs: PRELOADED_LANGUAGES,
  preferredHighlighter: "shiki-js",
  tokenizeMaxLineLength: TOKENIZE_MAX_LINE_LENGTH,
};

// Each file renders in its own shadow root, and the theme writes its own backgrounds onto the
// elements inside it, so the app's tokens go in as CSS the viewer injects there.
const TOKEN_CSS = `
[data-diffs-header], [data-diff], [data-file], [data-error-wrapper], [data-virtualizer-buffer] {
  --diffs-font-family: var(--font-mono);
  --diffs-header-font-family: var(--font-sans);
  --diffs-font-size: var(--type-detail);
  --diffs-line-height: var(--type-detail-leading);
  --diffs-light-bg: var(--surface);
  --diffs-dark-bg: var(--surface);
  --diffs-token-light-bg: transparent;
  --diffs-token-dark-bg: transparent;
  --diffs-fg-number-override: var(--ink-3);
}
`;

function diffItems(patch: string, version: number): CodeItem[] {
  const files: FileDiffMetadata[] = parsePatchFiles(patch, undefined, true).flatMap(
    (parsed) => parsed.files,
  );
  return files.map((fileDiff) => ({ id: fileDiff.name, type: "diff", version, fileDiff }));
}

interface DiffViewerProps {
  readonly patch: string;
  // Bumped on every read, because the viewer redraws an item only when its version moves.
  readonly version: number;
  readonly style: DiffStyle;
  readonly theme: Theme;
  readonly reveal: string | null;
  readonly renderActions: (path: string) => ReactNode;
}

export function DiffViewer({
  patch,
  version,
  style,
  theme,
  reveal,
  renderActions,
}: DiffViewerProps): ReactElement {
  const viewer = useRef<CodeViewHandle<undefined, undefined>>(null);
  const items = useMemo(() => diffItems(patch, version), [patch, version]);

  useEffect(() => {
    if (reveal !== null) {
      viewer.current?.scrollTo({ type: "item", id: reveal, align: "start" });
    }
  }, [reveal, items]);

  return (
    <WorkerPoolContextProvider poolOptions={POOL_OPTIONS} highlighterOptions={HIGHLIGHTER_OPTIONS}>
      <CodeView
        ref={viewer}
        items={items}
        className={cn("rde-diff min-h-0 flex-1 overflow-auto", SETTLES_ON_RESIZE)}
        options={{
          diffStyle: style,
          theme: THEMES,
          themeType: theme,
          overflow: "scroll",
          lineDiffType: "word",
          stickyHeaders: true,
          tokenizeMaxLineLength: TOKENIZE_MAX_LINE_LENGTH,
          unsafeCSS: TOKEN_CSS,
        }}
        renderHeaderMetadata={(item) => renderActions(item.id)}
      />
    </WorkerPoolContextProvider>
  );
}

interface FileViewerProps {
  readonly path: string;
  readonly text: string;
  // Bumped on every read, because the viewer redraws an item only when its version moves.
  readonly version: number;
  readonly theme: Theme;
}

export function FileViewer({ path, text, version, theme }: FileViewerProps): ReactElement {
  const items = useMemo<CodeItem[]>(
    () => [{ id: path, type: "file", version, file: { name: path, contents: text } }],
    [path, text, version],
  );

  return (
    <WorkerPoolContextProvider poolOptions={POOL_OPTIONS} highlighterOptions={HIGHLIGHTER_OPTIONS}>
      <CodeView
        items={items}
        className={cn("rde-diff rde-file min-h-0 flex-1 overflow-auto", SETTLES_ON_RESIZE)}
        options={{
          theme: THEMES,
          themeType: theme,
          overflow: "scroll",
          disableFileHeader: true,
          tokenizeMaxLineLength: TOKENIZE_MAX_LINE_LENGTH,
          unsafeCSS: TOKEN_CSS,
        }}
      />
    </WorkerPoolContextProvider>
  );
}
