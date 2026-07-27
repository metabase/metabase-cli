import { SetupInput, SetupResult } from "@metabase/client/domain/setup";
import { setupResultView } from "../output/views/setup";
import { renderSummary } from "../output/render";
import { readBody } from "../runtime/body";

import { bodyInputFlags } from "./body-flags";
import { connectionFlags, outputFlags, profileFlag } from "./flags";
import { defineMetabaseCommand } from "./runtime";

export default defineMetabaseCommand({
  meta: {
    name: "setup",
    description: "Complete the initial Metabase setup wizard with a default user",
  },
  capabilities: { minVersion: 58 },
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
    'mb setup --body \'{"token":"...","user":{"email":"a@b.c","password":"..."}}\'',
  ],
  async run({ args, ctx, getClient }) {
    const body = await readBody({ flag: args.body, file: args.file }, SetupInput);
    const client = await getClient();
    const result = await client.setup.create(body);
    renderSummary(result, setupResultView, "Metabase setup complete.", ctx);
  },
});
