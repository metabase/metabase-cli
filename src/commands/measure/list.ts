import { z } from "zod";

import { Measure, MeasureCompact, measureView } from "../../domain/measure";
import { renderList } from "../../output/render";
import { listEnvelopeSchema, wrapList } from "../../output/types";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

const MeasureApiList = z.array(Measure);

export const MeasureListEnvelope = listEnvelopeSchema(MeasureCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List measures" },
  args: { ...outputFlags, ...profileFlag, ...connectionFlags },
  outputSchema: MeasureListEnvelope,
  examples: ["metabase measure list", "metabase measure list --json"],
  async run({ ctx, getClient }) {
    const client = await getClient();
    const items = await client.requestParsed(MeasureApiList, "/api/measure");
    renderList(wrapList(items), measureView, ctx);
  },
});
