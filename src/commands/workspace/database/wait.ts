import type { Client } from "../../../core/http/client";
import { Workspace } from "../../../domain/workspace";
import { pollUntil } from "../../../runtime/poll";
import type { WaitSchedule } from "../../wait-flags";

export async function waitForDatabaseProvisioned(
  client: Client,
  workspaceId: number,
  databaseId: number,
  schedule: WaitSchedule,
): Promise<Workspace> {
  return pollUntil(
    () => client.requestParsed(Workspace, `/api/ee/workspace-manager/${workspaceId}`),
    (workspace) => {
      const entry = workspace.databases?.find((row) => row.database_id === databaseId);
      return entry !== undefined && entry.status === "provisioned";
    },
    schedule,
  );
}

export async function waitForDatabaseGone(
  client: Client,
  workspaceId: number,
  databaseId: number,
  schedule: WaitSchedule,
): Promise<void> {
  await pollUntil(
    () => client.requestParsed(Workspace, `/api/ee/workspace-manager/${workspaceId}`),
    (workspace) => {
      const entry = workspace.databases?.find((row) => row.database_id === databaseId);
      return entry === undefined;
    },
    schedule,
  );
}
