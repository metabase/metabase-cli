import { Workspace, WorkspaceCreateInput } from "@metabase/client/domain/workspace";
import { ConfigError } from "@metabase/client/errors";
import { renderSummary } from "../../output/render";
import { workspaceView } from "../../output/views/workspace";
import { givenValue } from "../../runtime/input";
import { bodyInputFlags } from "../body-flags";
import type { FlagValues } from "../flag-values";
import { connectionFlags, listFlag, outputFlags, profileFlag } from "../flags";
import { parseId, parseIdCsv } from "../parse-id";
import { parseText } from "../parse-text";
import { type BodyReader, defineMetabaseCommand } from "../runtime";

// The server provisions every database's warehouse isolation before it answers, which outlasts the
// 30 seconds a request gets by default.
const PROVISION_TIMEOUT_MS = 10 * 60_000;

const createFlags = {
  ...bodyInputFlags,
  name: { type: "string", description: "The workspace name (used with --database-ids)" },
  "database-ids": listFlag({
    type: "string",
    description: "Comma-separated ids of the databases to attach (used with --name)",
  }),
} as const;

/**
 * The flag pair and a body are alternatives, so a `--body` or `--file` beside the flags is refused
 * rather than dropped. A body piped on stdin is not read while the flags are given.
 */
async function readCreateInput(
  args: FlagValues<typeof createFlags>,
  readBody: BodyReader<WorkspaceCreateInput>,
): Promise<WorkspaceCreateInput> {
  if (args.name === undefined && args["database-ids"] === undefined) {
    return readBody({ flag: args.body, file: args.file });
  }
  if (givenValue(args.body) !== null || givenValue(args.file) !== null) {
    throw new ConfigError("--name, --database-ids cannot be combined with --body or --file");
  }
  if (args.name === undefined) {
    throw new ConfigError("--name is required when using --database-ids");
  }
  if (args["database-ids"] === undefined) {
    throw new ConfigError("--database-ids is required when using --name");
  }
  return {
    name: parseText(args.name, "--name"),
    database_ids: parseIdCsv(args["database-ids"], "database id"),
  };
}

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a workspace on the given databases" },
  details:
    "Pass `--name` and `--database-ids` together, or a JSON body with exactly `name` and `database_ids`. A body piped on stdin is not read while the flags are given. Each database must be eligible for workspaces. The server provisions each database's warehouse isolation before it answers, so the call waits up to `--timeout` ms; a provisioning failure whose cleanup also fails answers the workspace with its databases `unprovisioned`.",
  requires: ["workspaceManager.create"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...createFlags,
    timeout: {
      type: "string",
      description: "How long to wait for the databases to be provisioned, in ms",
      default: String(PROVISION_TIMEOUT_MS),
    },
  },
  inputSchema: WorkspaceCreateInput,
  outputSchema: Workspace,
  examples: [
    'mb workspace create --name "Orders rework" --database-ids 1',
    'mb workspace create --body \'{"name":"Orders rework","database_ids":[1,2]}\'',
  ],
  async run({ args, ctx, getClient, readBody }) {
    const timeoutMs = parseId(args.timeout, "--timeout");
    const body = await readCreateInput(args, readBody);
    const client = await getClient();
    const created = await client.workspaceManager.create(body, { timeoutMs });
    renderSummary(
      created,
      workspaceView,
      `Created workspace ${created.id} "${created.name}".`,
      ctx,
    );
  },
});
