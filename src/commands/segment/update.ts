import { Segment, SegmentUpdateInput, segmentView } from "../../domain/segment";
import { renderItem } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";
import {
  SEGMENT_DEFINITION_LABELS,
  preflightMbql5Query,
  skipValidateFlag,
} from "../validate-query";

export default defineMetabaseCommand({
  meta: {
    name: "update",
    description:
      "Update a segment by id; body must include revision_message (audit-logged). An MBQL 5 definition is pre-flight-validated; see `mb skills get mbql`.",
  },
  capabilities: { minVersion: 58, edition: "oss" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    ...skipValidateFlag,
    id: { type: "positional", description: "Segment id", required: true },
  },
  outputSchema: Segment,
  examples: [
    "cat patch.json | mb segment update 1",
    "mb segment update 1 --file patch.json",
    'mb segment update 1 --body \'{"name":"renamed","revision_message":"rename"}\'',
    "mb segment update 1 --file patch.json --skip-validate",
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const body = await readBody({ flag: args.body, file: args.file }, SegmentUpdateInput);
    preflightMbql5Query(body.definition, SEGMENT_DEFINITION_LABELS, {
      skip: args["skip-validate"] === true,
    });
    const client = await getClient();
    const updated = await client.requestParsed(Segment, `/api/segment/${id}`, {
      method: "PUT",
      body,
    });
    renderItem(updated, segmentView, ctx);
  },
});
