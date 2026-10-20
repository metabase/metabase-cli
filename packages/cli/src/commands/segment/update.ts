import { Segment, SegmentUpdateInput } from "@metabase/client/domain/segment";
import { segmentView } from "../../output/views/segment";
import { renderSummary } from "../../output/render";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";
import { SEGMENT_DEFINITION, skipValidateFlag } from "../validate-query";

export default defineMetabaseCommand({
  meta: {
    name: "update",
    description: "Update a segment by id (body must include revision_message)",
  },
  details:
    "Patches only the fields you send and must include `revision_message` (recorded in the audit log). When `definition` is an MBQL 5 query it is checked against a bundled JSON Schema (print it with `mb schema query`) before sending; pass --skip-validate to bypass.",
  skills: [{ skill: "mbql", purpose: "the definition filter clause" }],
  requires: ["segment.update"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    ...skipValidateFlag,
    id: { type: "positional", description: "Segment id", required: true },
  },
  inputSchema: SegmentUpdateInput,
  embeddedDocuments: [SEGMENT_DEFINITION],
  outputSchema: Segment,
  examples: [
    "cat patch.json | mb segment update 1",
    "mb segment update 1 --file patch.json",
    'mb segment update 1 --body \'{"name":"renamed","revision_message":"rename"}\'',
    "mb segment update 1 --file patch.json --skip-validate",
  ],
  async run({ args, ctx, getClient, readBody }) {
    const id = parseId(args.id);
    const body = await readBody({ flag: args.body, file: args.file });
    const client = await getClient();
    const updated = await client.segment.update(id, body);
    renderSummary(updated, segmentView, `Updated segment ${updated.id} "${updated.name}".`, ctx);
  },
});
