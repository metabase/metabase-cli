import { DataApp, DataAppCreateInput } from "@metabase/client/domain/data-app";
import { dataAppView } from "../../output/views/data-app";
import { renderSummary } from "../../output/render";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a data app and its collection from JSON" },
  details:
    "The JSON body needs `name`, the slug. Optional: `display_name` (the slug by default), `description`, `allowed_hosts`, `enabled` (true by default), `bundle_path` and `version`. The app starts with an empty bundle; a git-sync import replaces it with the `dist/index.js` committed in `data_apps/<slug>/`. The answer's `resource_collection_id` is the app's collection, where its questions and actions go. `mb data-app scaffold` copies the project template.",
  skills: [{ skill: "data-app", purpose: "how an app is created, built and published" }],
  requires: ["dataApp.create"],
  args: { ...outputFlags, ...profileFlag, ...connectionFlags, ...bodyInputFlags },
  inputSchema: DataAppCreateInput,
  outputSchema: DataApp,
  examples: [
    'mb data-app create --body \'{"name":"sales-overview","display_name":"Sales overview"}\'',
    "mb data-app create --file app.json --json",
  ],
  async run({ args, ctx, getClient, readBody }) {
    const body = await readBody({ flag: args.body, file: args.file });
    const client = await getClient();
    const created = await client.dataApp.create(body);
    renderSummary(
      created,
      dataAppView,
      `Created data app ${created.name} with collection ${created.resource_collection_id}.`,
      ctx,
    );
  },
});
