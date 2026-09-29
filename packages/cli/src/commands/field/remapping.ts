import { formatScalar, renderSummary } from "../../output/render";
import {
  type FieldRemappingMatch,
  type FieldRemappingMiss,
  FieldRemappingResult,
  fieldRemappingMatchView,
  fieldRemappingMissView,
  toValueLabel,
} from "../../output/views/field";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { parseText } from "../parse-text";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: {
    name: "remapping",
    description: "Look up another field's value on the row where a field equals a value",
  },
  details:
    "Answers `{ found: true, value, label }` with `label` the value of `<remapped-id>` on the one row where `<id>` equals `<value>`, or `{ found: false }` when no row does. A FK `<id>` is followed to the key it points at, and `<remapped-id>` must be on that key's table: the server answers a pair that is not, and any failure of the warehouse query, as `{ found: false }` rather than an error. When `<id>` is numeric the server reads the leading number of `<value>` and ignores any text after it (`20abc` looks up 20), failing only a value with no leading number; a value starting with `-` goes after `--` (`mb field remapping 100 101 -- -5`). In text mode the label prints bare so the result composes in a shell; an empty line means either no row matched or the matched label is empty, which `--json` tells apart.",
  requires: ["field.remapping"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Field id the value belongs to", required: true },
    "remapped-id": {
      type: "positional",
      description: "Field id whose value on that row is answered",
      required: true,
    },
    value: { type: "positional", description: "Value of <id> to look up", required: true },
  },
  outputSchema: FieldRemappingResult,
  examples: ["mb field remapping 100 101 20", "mb field remapping 100 101 20 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const remappedId = parseId(args["remapped-id"], "remapped-id");
    const value = parseText(args.value, "value");
    const client = await getClient();
    const pair = await client.field.remapping(id, remappedId, { value });
    if (pair === null) {
      const miss: FieldRemappingMiss = { found: false };
      renderSummary(miss, fieldRemappingMissView, "", ctx);
      return;
    }
    const match: FieldRemappingMatch = { found: true, ...toValueLabel(pair) };
    renderSummary(match, fieldRemappingMatchView, formatScalar(match.label), ctx);
  },
});
