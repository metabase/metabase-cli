import { ApiKeyCreateInput, CreatedApiKey } from "@metabase/client/domain/api-key";
import { createdApiKeyView } from "../../output/views/api-key";
import { renderSummary } from "../../output/render";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create an API key acting as a member of a group" },
  details:
    "Admins only. The JSON body needs `name` and `group_id` (`2` is Administrators). The key is printed once, in the summary line or as `unmasked_key` under `--json`, and no later read returns it: store it where it's needed and never paste it into chat.",
  requires: ["apiKey.create"],
  args: { ...outputFlags, ...profileFlag, ...connectionFlags, ...bodyInputFlags },
  inputSchema: ApiKeyCreateInput,
  outputSchema: CreatedApiKey,
  examples: ['mb api-key create --body \'{"name":"ci","group_id":2}\' --json'],
  async run({ args, ctx, getClient, readBody }) {
    const body = await readBody({ flag: args.body, file: args.file });
    const client = await getClient();
    const created = await client.apiKey.create(body);
    renderSummary(
      created,
      createdApiKeyView,
      `Created API key ${created.id} "${created.name}": ${created.unmasked_key}`,
      ctx,
    );
  },
});
