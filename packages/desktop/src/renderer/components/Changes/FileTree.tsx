import { FileTree as PierreTree, useFileTree } from "@pierre/trees/react";
import { useEffect, useRef, type ReactElement } from "react";

import type { DiffFile } from "../../../contracts/changes";
import { changesIn, countsLabel, fileNamed, treeExpansion } from "@/changes/files";
import { cn } from "@/cn";

const DIRECTORY_SUFFIX = "/";

// A long name is cut in the middle by a marker that hides the letters under it with the row's own
// background, so the tree paints the colour of the surface it sits on rather than none.
const GROUND_CLASS = {
  canvas: "rde-tree-canvas",
  surface: "rde-tree-surface",
} as const;

type TreeGround = keyof typeof GROUND_CLASS;

interface FileTreeProps {
  readonly label: string;
  readonly ground: TreeGround;
  readonly paths: readonly string[];
  readonly changes: readonly DiffFile[];
  readonly selected: string | null;
  readonly onSelect: (path: string) => void;
}

// The tree model is built once and fed new paths as they change, so a directory the person opened
// stays open across a refresh. Its callbacks read the latest props through refs for the same
// reason.
export function FileTree({
  label,
  ground,
  paths,
  changes,
  selected,
  onSelect,
}: FileTreeProps): ReactElement {
  const latestChanges = useRef(changes);
  const latestSelect = useRef(onSelect);
  latestChanges.current = changes;
  latestSelect.current = onSelect;

  const { model } = useFileTree({
    paths,
    flattenEmptyDirectories: true,
    initialExpansion: treeExpansion(paths.length),
    density: "compact",
    search: true,
    onSelectionChange: (chosen) => {
      const path = chosen[chosen.length - 1];
      if (path !== undefined && !path.endsWith(DIRECTORY_SUFFIX)) {
        latestSelect.current(path);
      }
    },
    renderRowDecoration: ({ item }) => {
      const file = item.kind === "file" ? fileNamed(latestChanges.current, item.path) : null;
      return file === null ? null : { text: countsLabel(file) };
    },
  });

  useEffect(() => {
    model.resetPaths(paths);
    model.setGitStatus(
      changesIn(paths, changes).map((file) => ({ path: file.path, status: file.change })),
    );
  }, [paths, changes, model]);

  // A file closed from outside leaves the tree, so choosing it again opens it again.
  useEffect(() => {
    if (selected !== null) {
      return;
    }
    for (const path of model.getSelectedPaths()) {
      model.getItem(path)?.deselect();
    }
  }, [selected, model]);

  return (
    <PierreTree
      model={model}
      aria-label={label}
      className={cn("rde-tree block h-full pt-1.5", GROUND_CLASS[ground])}
    />
  );
}
