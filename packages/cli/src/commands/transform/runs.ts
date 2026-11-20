import { TransformRunCompact } from "@metabase/client/domain/transform";

import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { transformRunView } from "../../output/views/transform";
import { collectForOutput } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export const TransformRunListEnvelope = listEnvelopeSchema(TransformRunCompact);

export default defineMetabaseCommand({
  meta: { name: "runs", description: "List recent transform runs" },
  details:
    "Lists runs across all transforms, or one transform's with `--transform-id`. The server pages the runs, so the CLI reads only the pages the output cap can show, and reports `has_more` and `next_offset` to continue.",
  requires: ["transform.runPages"],
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
    "transform-id": {
      type: "string",
      description: "Filter to runs of a single transform id",
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
    const client = await getClient();

    const envelope = await collectForOutput(
      (request) => client.transform.runPages({ "transform-ids": transformId }, request),
      transformRunView,
      ctx,
    );
    renderList(envelope, transformRunView, ctx);
  },
});
