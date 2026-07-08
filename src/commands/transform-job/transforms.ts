import { z } from "zod";

import { Transform, TransformCompact, transformView } from "../../domain/transform";
import { renderList } from "../../output/render";
import { listEnvelopeSchema, wrapList } from "../../output/types";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

const TransformApiList = z.array(Transform);

export const TransformJobTransformsEnvelope = listEnvelopeSchema(TransformCompact);

export default defineMetabaseCommand({
  meta: { name: "transforms", description: "List the transforms a job will run" },
  details:
    "Resolves the transforms a job would execute, matched by the job's tags. The positional id is a JOB id, not a transform id.",
  capabilities: { minVersion: 59 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Transform job id", required: true },
  },
  outputSchema: TransformJobTransformsEnvelope,
  examples: ["mb transform-job transforms 1", "mb transform-job transforms 1 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const items = await client.requestParsed(
      TransformApiList,
      `/api/transform-job/${id}/transforms`,
    );
    renderList(wrapList(items), transformView, ctx);
  },
});
