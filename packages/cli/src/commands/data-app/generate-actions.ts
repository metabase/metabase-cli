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
    "Run from the root of the synced git repository, after `npm install` in the app. Loads the `defineAction` exports of the app's `src/metabase.actions.ts`, has Metabase build the implicit action of each, named after its export and with its `entityId`, and replaces the action files of the app's collection under `collections/data_apps/` with them, leaving its question files alone. Nothing changes in Metabase until the repository is imported.",
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
