import { SetupInput, SetupResult, setupResultView } from "../domain/setup";
import { renderItem } from "../output/render";
import { readBody } from "../runtime/body";

import { bodyInputFlags } from "./body-flags";
import { connectionFlags, outputFlags, profileFlag } from "./flags";
import { defineMetabaseCommand } from "./runtime";

export default defineMetabaseCommand({
  meta: {
    name: "setup",
    description: "Complete the initial Metabase setup wizard with a default user",
  },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
  },
  outputSchema: SetupResult,
  examples: [
    "cat setup.json | metabase setup",
    "metabase setup --file setup.json",
    'metabase setup --body \'{"token":"...","user":{"email":"a@b.c","password":"..."}}\'',
  ],
  async run({ args, ctx, getClient }) {
    const body = await readBody({ flag: args.body, file: args.file }, SetupInput);
    const client = await getClient();
    const result = await client.requestParsed(SetupResult, "/api/setup", {
      method: "POST",
      body,
    });
    renderItem(result, setupResultView, ctx);
  },
});
