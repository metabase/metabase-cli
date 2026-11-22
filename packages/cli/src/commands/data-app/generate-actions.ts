import { DataAppGeneratedFiles } from "@metabase/client/domain/data-app";

import { writeText } from "../../output/render";
import {
  loadDataAppActions,
  readDataAppCollectionEntityId,
  writeDataAppCollectionFiles,
} from "../../runtime/data-app-project";
import { connectionFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { parseSlug, slugArg } from "./slug";

export default defineMetabaseCommand({
  meta: {
    name: "generate-actions",
    description: "Write a data app's actions as its collection's files, from the repository root",
  },
  details:
    "Run it after `npm install` in the app. Loads the `defineAction` exports of `src/metabase.actions.ts`, has Metabase build each one's implicit action (named after the export, with its `entityId`), and replaces the action files of the app's collection with them. Question files stay as they are, and Metabase changes only when you import the repository.",
  skills: [{ skill: "data-app-actions", purpose: "the actions the app defines" }],
  requires: ["dataApp.generateActions"],
  args: { ...profileFlag, ...connectionFlags, ...slugArg },
  outputSchema: DataAppGeneratedFiles,
  examples: ["mb data-app generate-actions sales-overview"],
  async run({ args, getClient }) {
    const slug = parseSlug(args.slug);
    const collection = await readDataAppCollectionEntityId(slug);
    const actions = await loadDataAppActions(slug);
    const client = await getClient();
    const files = await client.dataApp.generateActions({ collection, actions });
    const dir = await writeDataAppCollectionFiles(slug, "Action", files);
    writeText(`Wrote ${files.length} actions of data app ${slug} to ${dir}.`);
  },
});
