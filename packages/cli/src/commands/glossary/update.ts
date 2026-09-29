import { Glossary, GlossaryUpdateInput } from "@metabase/client/domain/glossary";
import { glossaryView } from "../../output/views/glossary";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

import { entryFlags, readEntryInput } from "./entry-flags";

export default defineMetabaseCommand({
  meta: { name: "update", description: "Replace the term and definition of a glossary entry" },
  details:
    "Both fields are replaced, so pass `--term` and `--definition` together, or a JSON body with exactly those two keys. A body piped on stdin is not read while the flags are given. Neither field may be blank.",
  requires: ["glossary.update"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...entryFlags,
    id: { type: "positional", description: "Glossary entry id", required: true },
  },
  inputSchema: GlossaryUpdateInput,
  outputSchema: Glossary,
  examples: [
    'mb glossary update 3 --term "Churn" --definition "Customers lost in a calendar month"',
    'mb glossary update 3 --body \'{"term":"Churn","definition":"Customers lost in a calendar month"}\'',
    "mb glossary update 3 --file entry.json",
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const body = await readEntryInput(args);
    const client = await getClient();
    const updated = await client.glossary.update(id, body);
    renderSummary(
      updated,
      glossaryView,
      `Updated glossary entry ${updated.id} "${updated.term}".`,
      ctx,
    );
  },
});
