import { Library, libraryView } from "../../domain/library";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

import { createLibrary } from "./resolve";

export default defineMetabaseCommand({
  meta: {
    name: "create",
    description: "Create the Library (Data + Metrics collections); idempotent",
  },
  details:
    "Creates the Library subtree if it doesn't exist and returns it; a no-op that returns the existing Library when it's already there. Only admins and data analysts can curate the Library.",
  capabilities: { minVersion: 59, tokenFeature: "library" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
  },
  outputSchema: Library,
  examples: ["mb library create", "mb library create --json"],
  async run({ ctx, getClient }) {
    const client = await getClient();
    const library = await createLibrary(client);
    renderSummary(library, libraryView, `Library ready (collection ${library.id}).`, ctx);
  },
});
