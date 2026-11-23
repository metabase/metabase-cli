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
    "Bootstraps a Metabase instance that isn't set up yet. The body carries the setup token, the default user, and a `prefs` block with `site_name`. The token is the `setup-token` that the server's public session properties carry before setup. Like every command that reaches a server, `setup` needs a URL and a credential (`--url` and `--api-key`, `$MB_URL` and `$MB_API_KEY`, or a profile), and exits 2 without one, though an instance that isn't set up has no API key yet.",
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
