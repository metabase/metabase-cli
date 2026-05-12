import { z } from "zod";

import type { ResourceView } from "../../domain/view";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export const TransformCancelResult = z.object({
  canceled: z.boolean(),
  id: z.number().int(),
});
export type TransformCancelResultJson = z.infer<typeof TransformCancelResult>;

const transformCancelView: ResourceView<TransformCancelResultJson> = {
  compactPick: TransformCancelResult,
  tableColumns: [
    { key: "id", label: "Transform" },
    { key: "canceled", label: "Canceled" },
  ],
};

export default defineMetabaseCommand({
  meta: { name: "cancel", description: "Cancel the current run for a transform" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Transform id", required: true },
  },
  outputSchema: TransformCancelResult,
  examples: ["metabase transform cancel 1", "metabase transform cancel 1 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    await client.requestRaw(`/api/transform/${id}/cancel`, {
      method: "POST",
      expectContentType: "binary",
    });
    renderItem({ canceled: true, id }, transformCancelView, ctx);
  },
});
