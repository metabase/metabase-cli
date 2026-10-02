import { z } from "zod";

import type { ResourceView } from "../../output/view";
import { renderSummary } from "../../output/render";
import { confirmDestructive } from "../delete-runtime";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { parseSlug, slugArg } from "./slug";

export const DataAppDeleteResult = z.object({
  deleted: z.boolean(),
  aborted: z.boolean(),
  slug: z.string(),
});
type DataAppDeleteResult = z.infer<typeof DataAppDeleteResult>;

const deleteResultView: ResourceView<DataAppDeleteResult> = {
  compactPick: DataAppDeleteResult,
  tableColumns: [
    { key: "slug", label: "Slug" },
    { key: "deleted", label: "Deleted" },
    { key: "aborted", label: "Aborted" },
  ],
};

export default defineMetabaseCommand({
  meta: {
    name: "delete",
    description: "Delete a data app with its bundle, collection and permission group",
  },
  requires: ["dataApp.delete"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    yes: { type: "boolean", description: "Skip confirmation", default: false },
    ...slugArg,
  },
  outputSchema: DataAppDeleteResult,
  examples: ["mb data-app delete sales-overview --yes", "mb data-app delete sales-overview"],
  async run({ args, ctx, getClient }) {
    const slug = parseSlug(args.slug);
    const client = await getClient();
    const confirmed = await confirmDestructive({
      yes: args.yes,
      action: `delete ${slug}`,
      promptMessage: `Delete data app ${slug}, its collection and its permission group?`,
    });
    if (!confirmed) {
      renderSummary(
        { deleted: false, aborted: true, slug },
        deleteResultView,
        `Aborted; data app ${slug} was not deleted.`,
        ctx,
      );
      return;
    }
    await client.dataApp.delete(slug);
    renderSummary(
      { deleted: true, aborted: false, slug },
      deleteResultView,
      `Deleted data app ${slug}.`,
      ctx,
    );
  },
});
