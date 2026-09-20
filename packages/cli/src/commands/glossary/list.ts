import { GlossaryCompact } from "@metabase/client/domain/glossary";
import { ConfigError } from "@metabase/client/errors";
import { glossaryView } from "../../output/views/glossary";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export const GlossaryListEnvelope = listEnvelopeSchema(GlossaryCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List glossary entries in term order" },
  details:
    "`--search` matches the term or the definition as a case-insensitive substring. Some servers read `%` and `_` in the text as SQL LIKE wildcards rather than literal characters.",
  requires: ["glossary.list"],
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
    search: {
      type: "string",
      description: "Keep entries whose term or definition contains this text (case-insensitive)",
    },
  },
  outputSchema: GlossaryListEnvelope,
  examples: ["mb glossary list", "mb glossary list --search churn --json"],
  async run({ args, ctx, getClient }) {
    const search = parseSearch(args.search);
    const client = await getClient();
    const { data } = await client.glossary.list({ search });
    renderList(windowList(data, ctx.range), glossaryView, ctx);
  },
});

// The server refuses a blank `search` rather than reading it as "no filter".
function parseSearch(raw: string | undefined): string | undefined {
  if (raw !== undefined && raw.trim() === "") {
    throw new ConfigError("--search must not be blank");
  }
  return raw;
}
