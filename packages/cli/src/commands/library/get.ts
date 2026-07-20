import { Library, libraryView } from "../../domain/library";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

import { fetchLibrary } from "./resolve";

export default defineMetabaseCommand({
  meta: {
    name: "get",
    description: "Show the Library and its Data / Metrics collection ids",
  },
  details:
    "Reads the Library root and its child collections. Use the `library-data` child's id as the target for publishing tables (or just run `mb library publish`, which resolves it for you).",
  capabilities: { minVersion: 59, tokenFeature: "library" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
  },
  outputSchema: Library,
  examples: ["mb library get", "mb library get --json"],
  async run({ ctx, getClient }) {
    const client = await getClient();
    const library = await fetchLibrary(client);
    if (library === null) {
      throw new Error(
        "The Library has not been created yet — run `mb library create` (or publish a table with `mb library publish`).",
      );
    }
    renderItem(library, libraryView, ctx);
  },
});
