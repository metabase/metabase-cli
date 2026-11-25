import { Library } from "@metabase/client/domain/library";
import { libraryView } from "../../output/views/library";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: {
    name: "create",
    description: "Create the Library and its collections (Data, Metrics, …); idempotent",
  },
  requires: ["library.create"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
  },
  outputSchema: Library,
  examples: ["mb library create", "mb library create --json"],
  async run({ ctx, getClient }) {
    const client = await getClient();
    const library = await client.library.create();
    renderSummary(library, libraryView, `Library ready (collection ${library.id}).`, ctx);
  },
});
