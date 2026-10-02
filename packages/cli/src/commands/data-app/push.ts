import { DataApp } from "@metabase/client/domain/data-app";
import { isHttpNotFound } from "@metabase/client/http/errors";
import { dataAppView } from "../../output/views/data-app";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { loadDataApp } from "./manifest";

export default defineMetabaseCommand({
  meta: {
    name: "push",
    description: "Publish a built data app from its directory through the API",
  },
  details:
    "Reads `data_app.yaml` in <dir> and the built bundle at its `path`, then updates the app with that slug, or creates it when there is none. Build first (`npm run build`). Only the manifest and the bundle reach Metabase; the app's source does not.",
  skills: [{ skill: "data-app", purpose: "build an app and choose between push and git sync" }],
  requires: ["dataApp.update", "dataApp.create"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    dir: {
      type: "positional",
      description: "App directory holding data_app.yaml",
      required: false,
      default: ".",
    },
  },
  outputSchema: DataApp,
  examples: ["mb data-app push", "mb data-app push data_apps/sales-overview --json"],
  async run({ args, ctx, getClient }) {
    const { slug, fields } = await loadDataApp(args.dir);
    const client = await getClient();
    try {
      const updated = await client.dataApp.update(slug, fields);
      renderSummary(
        updated,
        dataAppView,
        `Updated data app ${slug}; it is served at /apps/${slug}.`,
        ctx,
      );
    } catch (error) {
      if (!isHttpNotFound(error)) {
        throw error;
      }
      const created = await client.dataApp.create({ name: slug, ...fields });
      renderSummary(
        created,
        dataAppView,
        `Created data app ${slug}; it is served at /apps/${slug}.`,
        ctx,
      );
    }
  },
});
