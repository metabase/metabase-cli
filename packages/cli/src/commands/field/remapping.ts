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
    "Returns `{ found: true, value, label }`, where `label` is the value of `<remapped-id>` on the row where `<id>` equals `<value>`, or `{ found: false }` when no row matches. A FK `<id>` is followed to the key it points at, and `<remapped-id>` must be on that key's table; a pair that isn't, or a failed warehouse query, also returns `{ found: false }`. For a numeric `<id>`, only the leading number of `<value>` counts (`20abc` looks up 20), and a negative number goes in as it is (`mb field remapping 100 101 -5`). Any other value that starts with `-` goes after `--` (`mb field remapping 100 101 -- -a`). The text output is the label alone; use `--json` to tell no match from an empty label.",
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
  examples: [
    "mb field remapping 100 101 20",
    "mb field remapping 100 101 20 --json",
    "NAME=$(mb field remapping 100 101 20 --format text)",
  ],
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
