import { TransformRun, TransformRunCompact, transformRunView } from "../../domain/transform";
import { renderList } from "../../output/render";
import { listEnvelopeSchema, type ListEnvelope } from "../../output/types";
import { collectPaginated } from "../../runtime/paginate";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export const TransformRunListEnvelope = listEnvelopeSchema(TransformRunCompact);

export default defineMetabaseCommand({
  meta: { name: "runs", description: "List recent transform runs" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    "transform-id": {
      type: "string",
      description: "Filter to runs of a single transform id",
    },
    limit: {
      type: "string",
      description: "Cap total runs returned (default: drain all pages)",
    },
  },
  outputSchema: TransformRunListEnvelope,
  examples: [
    "mb transform runs",
    "mb transform runs --transform-id 1 --json",
    "mb transform runs --limit 10 --json",
  ],
  async run({ args, ctx, getClient }) {
    const transformId =
      args["transform-id"] === undefined
        ? undefined
        : parseId(args["transform-id"], "--transform-id");
    const max = args.limit === undefined ? undefined : parseId(args.limit, "--limit");
    const client = await getClient();

    const items = await collectPaginated(client, "/api/transform/run", TransformRun, {
      query: { "transform-ids": transformId },
      ...(max !== undefined && { max }),
    });

    const envelope: ListEnvelope<TransformRun> = {
      data: items,
      returned: items.length,
      ...(max === undefined ? { total: items.length } : { limit: max }),
    };
    renderList(envelope, transformRunView, ctx);
  },
});
