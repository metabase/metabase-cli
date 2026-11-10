import { z } from "zod";

import { WorkspaceInstance } from "../domain/workspace-instance";
import type { RequestOptions, Transport } from "../http/transport";
import { explainer } from "../version/refusal";

const WorkspaceInstanceEnvelope = z.object({ data: WorkspaceInstance.nullable() }).loose();

export function workspaceInstanceResource(transport: Transport) {
  const { explain } = explainer(transport, "workspaceInstance");

  /**
   * The workspace loaded on this instance, from its `config.yml` at boot or set at runtime; admins
   * only. `null` when none is loaded, as on a manager-only instance. `can_write` is `false` when
   * deployment config set the workspace, which then cannot be changed at runtime.
   */
  async function current(options: RequestOptions = {}): Promise<WorkspaceInstance | null> {
    const response = await transport.requestParsed(
      WorkspaceInstanceEnvelope,
      "/api/ee/workspace-instance/current",
      { ...options },
    );
    return response.data;
  }

  return {
    current: explain("current", current),
  };
}
