import { Segment, SegmentCreateInput, segmentView } from "../../domain/segment";
import { renderItem } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import {
  SEGMENT_DEFINITION_LABELS,
  preflightMbql5Query,
  skipValidateFlag,
} from "../validate-query";

export default defineMetabaseCommand({
  meta: {
    name: "create",
    description:
      "Create a segment from a JSON spec. An MBQL 5 definition is pre-flight-validated; see `mb skills get mbql`.",
  },
  capabilities: { minVersion: 58, edition: "oss" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    ...skipValidateFlag,
  },
  outputSchema: Segment,
  examples: [
    "cat segment.json | mb segment create",
    "mb segment create --file segment.json",
    "mb segment create --file segment.json --skip-validate",
  ],
  async run({ args, ctx, getClient }) {
    const body = await readBody({ flag: args.body, file: args.file }, SegmentCreateInput);
    preflightMbql5Query(body.definition, SEGMENT_DEFINITION_LABELS, {
      skip: args["skip-validate"] === true,
    });
    const client = await getClient();
    const created = await client.requestParsed(Segment, "/api/segment", {
      method: "POST",
      body,
    });
    renderItem(created, segmentView, ctx);
  },
});
