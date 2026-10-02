import { DataApp } from "@metabase/client/domain/data-app";
import { dataAppView } from "../../output/views/data-app";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { parseSlug, slugArg } from "./slug";

export default defineMetabaseCommand({
  meta: { name: "draft", description: "Reserve a slug and its resources before the app is pushed" },
  details:
    "Creates, or reuses, a draft holding the slug, its collection and its permission group. The first `push` or sync of that slug turns the draft into the app. Drafts are listed to admins and never served.",
  requires: ["dataApp.draft"],
  args: { ...outputFlags, ...profileFlag, ...connectionFlags, ...slugArg },
  outputSchema: DataApp,
  examples: ["mb data-app draft sales-overview"],
  async run({ args, ctx, getClient }) {
    const slug = parseSlug(args.slug);
    const client = await getClient();
    const drafted = await client.dataApp.draft(slug);
    renderSummary(drafted, dataAppView, `Reserved data app ${drafted.name}.`, ctx);
  },
});
