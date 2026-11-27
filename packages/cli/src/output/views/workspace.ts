import { type Workspace, WorkspaceCompact } from "@metabase/client/domain/workspace";
import {
  type WorkspaceInstance,
  WorkspaceInstanceCompact,
} from "@metabase/client/domain/workspace-instance";

import { MALFORMED_CELL } from "../table";
import type { ResourceView } from "../view";

const Databases = WorkspaceCompact.shape.databases;

function formatDatabases(value: unknown): string {
  const parsed = Databases.safeParse(value);
  if (!parsed.success) {
    return MALFORMED_CELL;
  }
  if (parsed.data === undefined) {
    return "";
  }
  return parsed.data.map((database) => `${database.database_id} (${database.status})`).join(", ");
}

export const workspaceView: ResourceView<Workspace> = {
  compactPick: WorkspaceCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "databases", label: "Databases", format: formatDatabases },
  ],
};

export const workspaceInstanceView: ResourceView<WorkspaceInstance> = {
  compactPick: WorkspaceInstanceCompact,
  tableColumns: [
    { key: "name", label: "Name" },
    { key: "can_write", label: "Writable" },
  ],
};
