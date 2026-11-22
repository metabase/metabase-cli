import { DataAppGeneratedFiles } from "@metabase/client/domain/data-app";

import { writeText } from "../../output/render";
import {
  loadDataAppQueries,
  readDataAppCollectionEntityId,
  writeDataAppCollectionFiles,
} from "../../runtime/data-app-project";
import { connectionFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { parseSlug, slugArg } from "./slug";

export default defineMetabaseCommand({
  meta: {
    name: "generate-queries",
    description: "Write a data app's questions as its collection's files, from the repository root",
  },
  details:
    "Run it after `npm install` in the app. Loads the `defineQuery` exports of `src/metabase.queries.ts`, has Metabase build each one's question (named after the export, with its `entityId`), and replaces the question files of the app's collection with them. Action files stay as they are.",
  skills: [{ skill: "data-app-data", purpose: "the questions the app defines" }],
  requires: ["dataApp.generateQueries"],
  args: { ...profileFlag, ...connectionFlags, ...slugArg },
  outputSchema: DataAppGeneratedFiles,
  examples: ["mb data-app generate-queries sales-overview"],
  async run({ args, getClient }) {
    const slug = parseSlug(args.slug);
    const collection = await readDataAppCollectionEntityId(slug);
    const queries = await loadDataAppQueries(slug);
    const client = await getClient();
    const files = await client.dataApp.generateQueries({
      collection,
      queries: Object.fromEntries(
        Object.entries(queries).map(([name, definition]) => [
          name,
          { entityId: definition.entityId, query: { stages: [definition] } },
        ]),
      ),
    });
    const dir = await writeDataAppCollectionFiles(slug, "Card", files);
    writeText(`Wrote ${files.length} questions of data app ${slug} to ${dir}.`);
  },
});
