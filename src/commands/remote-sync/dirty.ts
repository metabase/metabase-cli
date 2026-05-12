import { z } from "zod";

import { SyncDirtyItem, SyncDirtyItemCompact, syncDirtyItemView } from "../../domain/remote-sync";
import { renderList } from "../../output/render";
import { listEnvelopeSchema, wrapList } from "../../output/types";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

import { REMOTE_SYNC_PATHS } from "./poll-task";

const SyncDirtyApiResponse = z.object({
  dirty: z.array(SyncDirtyItem),
});

export const SyncDirtyListEnvelope = listEnvelopeSchema(SyncDirtyItemCompact);

export default defineMetabaseCommand({
  meta: { name: "dirty", description: "List objects with unsynced local changes" },
  args: { ...outputFlags, ...profileFlag, ...connectionFlags },
  outputSchema: SyncDirtyListEnvelope,
  examples: ["metabase remote-sync dirty", "metabase remote-sync dirty --json"],
  async run({ ctx, getClient }) {
    const client = await getClient();
    const response = await client.requestParsed(SyncDirtyApiResponse, REMOTE_SYNC_PATHS.dirty);
    renderList(wrapList(response.dirty), syncDirtyItemView, ctx);
  },
});
