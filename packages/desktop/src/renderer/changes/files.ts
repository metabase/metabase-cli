import type { DiffFile, FileChange } from "../../contracts/changes";

const CHANGE_WORDS: Readonly<Record<FileChange, string>> = {
  added: "Added",
  modified: "Modified",
  deleted: "Deleted",
  renamed: "Renamed",
};

export function changeWord(change: FileChange): string {
  return CHANGE_WORDS[change];
}

interface ChangeTotals {
  readonly files: number;
  readonly added: number;
  readonly removed: number;
}

export function changeTotals(files: readonly DiffFile[]): ChangeTotals {
  return files.reduce<ChangeTotals>(
    (totals, file) => ({
      files: totals.files + 1,
      added: totals.added + file.added,
      removed: totals.removed + file.removed,
    }),
    { files: 0, added: 0, removed: 0 },
  );
}

export function totalsLine(totals: ChangeTotals): string {
  const noun = totals.files === 1 ? "file" : "files";
  return `${totals.files} ${noun} changed`;
}

export function countsLabel(file: DiffFile): string {
  return file.binary ? "binary" : `+${file.added} −${file.removed}`;
}

export function fileNamed(files: readonly DiffFile[], path: string): DiffFile | null {
  return files.find((file) => file.path === path) ?? null;
}

export type TreeExpansion = "open" | "closed";

// A tree this short reads whole at a glance; a longer one opens folded so it can be browsed.
const OPEN_TREE_LIMIT = 200;

export function treeExpansion(paths: number): TreeExpansion {
  return paths <= OPEN_TREE_LIMIT ? "open" : "closed";
}

// A change is marked only where the tree has a row for it; a deleted file has none in a checkout.
export function changesIn(paths: readonly string[], changes: readonly DiffFile[]): DiffFile[] {
  const present = new Set(paths);
  return changes.filter((file) => present.has(file.path));
}
