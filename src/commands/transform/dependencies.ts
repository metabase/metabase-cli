import { z } from "zod";

import { Transform, TransformCompact, transformView } from "../../domain/transform";
import { renderList } from "../../output/render";
import { listEnvelopeSchema, wrapList } from "../../output/types";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

const TransformApiList = z.array(Transform);

export const TransformDependenciesEnvelope = listEnvelopeSchema(TransformCompact);

export default defineMetabaseCommand({
  meta: { name: "dependencies", description: "List the transforms a transform depends on" },
  details:
    "Returns the upstream transforms in this transform's dependency graph — the ones that must run before it. The positional id is a transform id.",
  capabilities: { minVersion: 59 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Transform id", required: true },
  },
  outputSchema: TransformDependenciesEnvelope,
  examples: ["mb transform dependencies 1", "mb transform dependencies 1 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const items = await client.requestParsed(TransformApiList, `/api/transform/${id}/dependencies`);
    renderList(wrapList(items), transformView, ctx);
  },
});
