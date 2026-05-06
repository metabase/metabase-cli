import { pipeToStdout } from "../../output/stream";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: {
    name: "metadata-export",
    description: "Download a workspace's table metadata (raw stream to stdout)",
  },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    "with-databases": {
      type: "boolean",
      description: "Include database entries in the export",
      default: true,
    },
    "with-tables": {
      type: "boolean",
      description: "Include table entries in the export",
      default: true,
    },
    "with-fields": {
      type: "boolean",
      description: "Include field entries in the export",
      default: true,
    },
    id: { type: "positional", description: "Workspace id", required: true },
  },
  examples: [
    "metabase workspace metadata-export 1 > metadata.json",
    "metabase workspace metadata-export 1 --no-with-fields > metadata.json",
  ],
  async run({ args, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const stream = await client.requestStream(`/api/ee/workspace-manager/${id}/metadata/export`, {
      query: {
        "with-databases": args["with-databases"],
        "with-tables": args["with-tables"],
        "with-fields": args["with-fields"],
      },
    });
    await pipeToStdout(stream);
  },
});
