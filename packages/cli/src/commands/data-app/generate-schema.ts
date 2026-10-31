import { join } from "node:path";

import { DataAppGeneratedFiles } from "@metabase/client/domain/data-app";
import { writeText } from "../../output/render";
import { dataAppDir, writeProjectFile } from "../../runtime/data-app-project";
import { connectionFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { parseSlug, slugArg } from "./slug";

export default defineMetabaseCommand({
  meta: {
    name: "generate-schema",
    description: "Write a data app's src/metabase.schema.ts, from the repository root",
  },
  details:
    "Run from the root of the synced git repository. Metabase generates the Library's published tables, with their fields, segments and measures, and the Library's metrics, by numeric ID; `defineQuery` and `defineAction` definitions in `src/metabase.queries.ts` and `src/metabase.actions.ts` are written against it. The IDs are this instance's, so the dev preview runs against it; a production build runs the questions and actions by entity ID. Fetch it again after publishing tables or changing their metadata.",
  skills: [{ skill: "data-app-data", purpose: "defining the app's questions and actions" }],
  requires: ["dataApp.generateSchema"],
  args: { ...profileFlag, ...connectionFlags, ...slugArg },
  outputSchema: DataAppGeneratedFiles,
  examples: ["mb data-app generate-schema sales-overview"],
  async run({ args, getClient }) {
    const slug = parseSlug(args.slug);
    const client = await getClient();
    const files = await client.dataApp.generateSchema();
    for (const file of files) {
      await writeProjectFile(join(dataAppDir(slug), file.path), file.contents);
    }
    writeText(`Wrote ${files.map((file) => join(dataAppDir(slug), file.path)).join(", ")}.`);
  },
});
