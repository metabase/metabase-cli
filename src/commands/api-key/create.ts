import { ApiKey, ApiKeyCreateInput, apiKeyView } from "../../domain/api-key";
import { renderItem } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { requireBothOrNeither } from "../flag-pair";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a new API key" },
  capabilities: { minVersion: 58, edition: "oss" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    name: { type: "string", description: "API key name (alternative to --body / --file)" },
    "group-id": {
      type: "string",
      description: "Permission group id (alternative to --body / --file)",
    },
  },
  outputSchema: ApiKey,
  examples: [
    'mb api-key create --name "deploy-bot" --group-id 2',
    'echo \'{"name":"k","group_id":2}\' | mb api-key create',
    "mb api-key create --file key.json",
  ],
  async run({ args, ctx, getClient }) {
    const pair = requireBothOrNeither(
      { name: "--name", value: args.name },
      { name: "--group-id", value: args["group-id"] },
    );
    const body = pair
      ? ApiKeyCreateInput.parse({
          name: pair.first,
          group_id: parseId(pair.second, "--group-id"),
        })
      : await readBody({ flag: args.body, file: args.file }, ApiKeyCreateInput);
    const client = await getClient();
    const created = await client.requestParsed(ApiKey, "/api/api-key", {
      method: "POST",
      body,
    });
    renderItem(created, apiKeyView, ctx);
  },
});
