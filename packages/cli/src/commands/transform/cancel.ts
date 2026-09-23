import { z } from "zod";

import type { ResourceView } from "../../output/view";
import { renderSummary } from "../../output/render";
import { outputFlags, preflightFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

const TransformCancelResult = z.object({
  canceled: z.boolean(),
  id: z.number().int(),
});
type TransformCancelResultJson = z.infer<typeof TransformCancelResult>;

const transformCancelView: ResourceView<TransformCancelResultJson> = {
  compactPick: TransformCancelResult,
  tableColumns: [
    { key: "id", label: "Transform" },
    { key: "canceled", label: "Canceled" },
  ],
};

export default defineMetabaseCommand({
  meta: { name: "cancel", description: "Cancel the current run for a transform" },
  requires: ["transform.cancel"],
  args: {
    ...outputFlags,
    ...preflightFlag,
    id: { type: "positional", description: "Transform id", required: true },
  },
  outputSchema: TransformCancelResult,
  examples: ["mb transform cancel 1", "mb transform cancel 1 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    await client.transform.cancel(id);
    renderSummary(
      { canceled: true, id },
      transformCancelView,
      `Canceled the current run for transform ${id}.`,
      ctx,
    );
  },
});
