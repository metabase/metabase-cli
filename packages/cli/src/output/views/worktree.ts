import { type Worktree, WorktreeCompact } from "@metabase/client/domain/worktree";

import type { ResourceView } from "../view";

export const worktreeView: ResourceView<Worktree> = {
  compactPick: WorktreeCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "branch", label: "Branch" },
  ],
};
