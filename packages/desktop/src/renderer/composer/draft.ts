import { PermissionMode } from "../../contracts/events";
import type { ProviderKind } from "../../contracts/providers";

export const WORKSPACE_MODES = ["worktree", "in-place"] as const;

export type WorkspaceMode = (typeof WORKSPACE_MODES)[number];

export const WORKSPACE_LABELS: Readonly<Record<WorkspaceMode, string>> = {
  worktree: "New worktree",
  "in-place": "In the repository",
};

export const PERMISSION_MODES: readonly PermissionMode[] = PermissionMode.options;

export const PERMISSION_LABELS: Readonly<Record<PermissionMode, string>> = {
  ask: "Ask first",
  edits: "Allow edits",
  "auto-review": "Auto",
  bypass: "Skip every check",
};

// A null choice follows Settings › Agents; a value is what the composer picked for this session.
export interface NewSessionDraft {
  readonly text: string;
  readonly provider: ProviderKind | null;
  readonly model: string | null;
  readonly workspace: WorkspaceMode;
  readonly permissionMode: PermissionMode | null;
}

export const EMPTY_DRAFT: NewSessionDraft = {
  text: "",
  provider: null,
  model: null,
  workspace: "worktree",
  permissionMode: null,
};
