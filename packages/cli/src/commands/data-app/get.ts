import { DataAppEntry } from "@metabase/client/domain/data-app";
import { dataAppView } from "../../output/views/data-app";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { parseSlug, slugArg } from "./slug";

export default defineMetabaseCommand({
  meta: { name: "get", description: "Get an enabled data app by slug" },
  requires: ["dataApp.get"],
  args: { ...outputFlags, ...profileFlag, ...connectionFlags, ...slugArg },
  outputSchema: DataAppEntry,
  examples: ["mb data-app get sales-overview", "mb data-app get sales-overview --json --full"],
  async run({ args, ctx, getClient }) {
    const slug = parseSlug(args.slug);
    const client = await getClient();
    renderItem(await client.dataApp.get(slug), dataAppView, ctx);
  },
});
