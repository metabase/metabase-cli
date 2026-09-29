import { Glossary, GlossaryCreateInput } from "@metabase/client/domain/glossary";
import { glossaryView } from "../../output/views/glossary";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

import { entryFlags, readEntryInput } from "./entry-flags";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a glossary entry, a term and its definition" },
  details:
    "Pass `--term` and `--definition` together, or a JSON body with exactly those two keys. A body piped on stdin is not read while the flags are given. Neither field may be blank. Terms are unique.",
  requires: ["glossary.create"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...entryFlags,
  },
  inputSchema: GlossaryCreateInput,
  outputSchema: Glossary,
  examples: [
    'mb glossary create --term "Churn" --definition "Customers lost in a period"',
    'mb glossary create --body \'{"term":"Churn","definition":"Customers lost in a period"}\'',
    "mb glossary create --file entry.json",
  ],
  async run({ args, ctx, getClient }) {
    const body = await readEntryInput(args);
    const client = await getClient();
    const created = await client.glossary.create(body);
    renderSummary(
      created,
      glossaryView,
      `Created glossary entry ${created.id} "${created.term}".`,
      ctx,
    );
  },
});
