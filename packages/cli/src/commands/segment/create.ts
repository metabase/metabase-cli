import { Segment, SegmentCreateInput } from "@metabase/client/domain/segment";
import { segmentView } from "../../output/views/segment";
import { renderSummary } from "../../output/render";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { SEGMENT_DEFINITION, skipValidateFlag } from "../validate-query";

export default defineMetabaseCommand({
  meta: {
    name: "create",
    description: "Create a segment (saved filter) from JSON",
  },
  details:
    "A segment is a saved row filter on a table, which cards reuse in their filters. The JSON body needs `name`, `table_id` and a `definition` (an MBQL query holding the filter).",
  skills: [{ skill: "mbql", purpose: "the definition filter clause" }],
  requires: ["segment.create"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    ...skipValidateFlag,
  },
  inputSchema: SegmentCreateInput,
  embeddedDocuments: [SEGMENT_DEFINITION],
  outputSchema: Segment,
  examples: [
    "cat segment.json | mb segment create",
    "mb segment create --file segment.json",
    "mb segment create --file segment.json --skip-validate",
  ],
  async run({ args, ctx, getClient, readBody }) {
    const body = await readBody({ flag: args.body, file: args.file });
    const client = await getClient();
    const created = await client.segment.create(body);
    renderSummary(created, segmentView, `Created segment ${created.id} "${created.name}".`, ctx);
  },
});
