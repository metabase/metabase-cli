import { DataApp, DataAppCreateInput } from "@metabase/client/domain/data-app";
import { dataAppView } from "../../output/views/data-app";
import { renderSummary } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { bundleFlag, withBundle } from "./files";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a data app from JSON and a built bundle" },
  details:
    "The JSON body takes `name` (the slug), `display_name`, `bundle_path`, and optionally `description`, `version` and `allowed_hosts`; --bundle reads the built bundle into `bundle`. `mb data-app push <dir>` builds this body from a data_app.yaml.",
  skills: [{ skill: "data-app", purpose: "the manifest fields and how an app is published" }],
  requires: ["dataApp.create"],
  args: { ...outputFlags, ...profileFlag, ...connectionFlags, ...bodyInputFlags, ...bundleFlag },
  inputSchema: DataAppCreateInput,
  outputSchema: DataApp,
  examples: [
    'mb data-app create --bundle dist/index.js --body \'{"name":"sales-overview","display_name":"Sales overview","bundle_path":"dist/index.js"}\'',
    "mb data-app create --bundle dist/index.js --file app.json",
  ],
  async run({ args, ctx, getClient }) {
    const body = await readBody(
      { flag: args.body, file: args.file },
      DataAppCreateInput.partial({ bundle: true }),
    );
    const input = DataAppCreateInput.parse(await withBundle(body, args.bundle));
    const client = await getClient();
    const created = await client.dataApp.create(input);
    renderSummary(
      created,
      dataAppView,
      `Created data app ${created.name} at /apps/${created.name}.`,
      ctx,
    );
  },
});
