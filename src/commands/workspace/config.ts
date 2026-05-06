import { pipeToStdout } from "../../output/stream";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: {
    name: "config",
    description: "Download a workspace's config file (raw stream to stdout)",
  },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Workspace id", required: true },
  },
  examples: ["metabase workspace config 1 > config.yml", "metabase workspace config 1 | yq ."],
  async run({ args, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const stream = await client.requestStream(`/api/ee/workspace-manager/${id}/config`);
    await pipeToStdout(stream);
  },
});
