import { Library } from "@metabase/client/domain/library";
import { libraryView } from "../../output/views/library";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: {
    name: "get",
    description: "Show the Library and its Data / Metrics collection ids",
  },
  details:
    "Fails when the Library hasn't been created yet. Use the `library-data` child's ID as the target for publishing tables, or run `mb library publish`, which finds it for you.",
  requires: ["library.get"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
  },
  outputSchema: Library,
  examples: ["mb library get", "mb library get --json"],
  async run({ ctx, getClient }) {
    const client = await getClient();
    const library = await client.library.get();
    if (library === null) {
      throw new Error(
        "The Library has not been created yet — run `mb library create` (or publish a table with `mb library publish`).",
      );
    }
    renderItem(library, libraryView, ctx);
  },
});
