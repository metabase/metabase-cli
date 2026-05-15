import {
  checkDockerReady,
  containerLifecycleStatus,
  containerNameFor,
  streamLogs,
} from "../../core/docker";
import { ConfigError } from "../../core/errors";
import { outputFlags } from "../flags";
import { parseId } from "../parse-id";
import { parseInteger } from "../parse-integer";
import { defineMetabaseCommand } from "../runtime";

const DEFAULT_TAIL = 200;

export default defineMetabaseCommand({
  meta: {
    name: "logs",
    description: "Stream the local container's logs (passthrough to `docker logs`)",
  },
  args: {
    ...outputFlags,
    id: { type: "positional", description: "Workspace id", required: true },
    follow: {
      type: "boolean",
      alias: "f",
      description: "Follow log output (stream indefinitely; Ctrl-C to exit)",
      default: false,
    },
    tail: {
      type: "string",
      description: `Number of lines from the end of the logs (default: ${DEFAULT_TAIL})`,
      default: String(DEFAULT_TAIL),
    },
  },
  examples: [
    "mb workspace logs 1",
    "mb workspace logs 1 --follow",
    "mb workspace logs 1 --tail 500",
  ],
  async run({ args }) {
    const workspaceId = parseId(args.id);
    const containerName = containerNameFor(workspaceId);
    const tail = parseInteger(args.tail ?? String(DEFAULT_TAIL), { name: "--tail", min: 0 });

    await checkDockerReady();
    const status = await containerLifecycleStatus(containerName);
    if (status === "missing") {
      throw new ConfigError(
        `no container for workspace ${workspaceId} — run \`mb workspace start ${workspaceId}\` first`,
      );
    }

    await streamLogs(containerName, { follow: args.follow === true, tail });
  },
});
