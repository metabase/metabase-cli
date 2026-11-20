import { SetupInput, SetupResult } from "@metabase/client/domain/setup";
import { setupResultView } from "../output/views/setup";
import { renderSummary } from "../output/render";

import { bodyInputFlags } from "./body-flags";
import { connectionFlags, outputFlags, profileFlag } from "./flags";
import { defineMetabaseCommand } from "./runtime";

export default defineMetabaseCommand({
  meta: {
    name: "setup",
    description: "Complete the initial Metabase setup wizard with a default user",
  },
  details:
    "Bootstraps a fresh Metabase instance that is not set up yet. The body carries the setup token, the default user, and a `prefs` block with `site_name`.",
  requires: ["setup.create"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
  },
  inputSchema: SetupInput,
  outputSchema: SetupResult,
  examples: [
    "cat setup.json | mb setup",
    "mb setup --file setup.json",
    'mb setup --body \'{"token":"<setup-token>","user":{"email":"a@b.c","password":"..."},"prefs":{"site_name":"Acme"}}\'',
  ],
  async run({ args, ctx, getClient, readBody }) {
    const body = await readBody({ flag: args.body, file: args.file });
    const client = await getClient();
    const result = await client.setup.create(body);
    renderSummary(result, setupResultView, "Metabase setup complete.", ctx);
  },
});
