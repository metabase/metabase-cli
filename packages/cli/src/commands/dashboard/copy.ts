import { DashboardCopy } from "@metabase/client/domain/dashboard";
import { dashboardCopyView } from "../../output/views/dashboard";
import { renderSummary } from "../../output/render";
import { copyFlags, parseCopyFlags } from "../copy-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: {
    name: "copy",
    description: "Copy a dashboard, with its tabs and dashcards, into a collection",
  },
  details:
    "The copy references the source cards; --deep duplicates its questions and metrics into the target collection instead and keeps referencing its models. A dashboard holding dashboard questions must be copied with --deep. Copied into the source dashboard's own collection, a duplicated card's name gets the suffix \" - Duplicate\", translated into your Metabase language. Without --collection-id the copy lands in the root collection. Archived cards, cards you cannot read, and every card on a dashcard whose main card you cannot read are left out and listed by id as `uncopied`, once per dashcard they sat on. A left-out main card takes its dashcard with it; a left-out series card stays on a dashcard whose main card is referenced and is dropped from one whose main card is duplicated. Action, link and placeholder dashcards are not copied.",
  requires: ["dashboard.copy"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...copyFlags,
    id: { type: "positional", description: "Dashboard id", required: true },
    description: {
      type: "string",
      description: "Description for the copy (default: the source description)",
    },
    deep: {
      type: "boolean",
      description: "Duplicate the questions and metrics instead of referencing them",
    },
  },
  outputSchema: DashboardCopy,
  examples: [
    "mb dashboard copy 1",
    'mb dashboard copy 1 --deep --collection-id 4 --name "Orders (copy)" --json',
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const target = parseCopyFlags(args);
    const client = await getClient();
    const copied = await client.dashboard.copy(id, {
      ...target,
      description: args.description,
      is_deep_copy: args.deep ? true : undefined,
    });
    renderSummary(copied, dashboardCopyView, () => copySummary(id, copied), ctx);
  },
});

function copySummary(sourceId: number, copied: DashboardCopy): string {
  const summary = `Copied dashboard ${sourceId} to ${copied.id} "${copied.name}".`;
  if (copied.uncopied === undefined) {
    return summary;
  }
  const leftOut = [...new Set(copied.uncopied.map((card) => card.id))];
  if (leftOut.length === 0) {
    return summary;
  }
  return `${summary}\nLeft out ${leftOut.length} card(s), each archived, unreadable, or on a dashcard whose card you cannot read: ${leftOut.join(", ")}.`;
}
