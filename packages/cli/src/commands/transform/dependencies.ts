import { TransformCompact } from "@metabase/client/domain/transform";
import { transformView } from "../../output/views/transform";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export const TransformDependenciesEnvelope = listEnvelopeSchema(TransformCompact);

export default defineMetabaseCommand({
  meta: { name: "dependencies", description: "List the transforms a transform depends on" },
  details:
    "Returns the upstream transforms in this transform's dependency graph — the ones that must run before it. The positional id is a transform id.",
  capabilities: { minVersion: 59 },
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Transform id", required: true },
  },
  outputSchema: TransformDependenciesEnvelope,
  examples: ["mb transform dependencies 1", "mb transform dependencies 1 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const { data } = await client.transform.dependencies(id);
    renderList(windowList(data, ctx.range), transformView, ctx);
  },
});
