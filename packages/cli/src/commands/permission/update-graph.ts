import {
  PermissionsGraphRevision,
  PermissionsGraphUpdateInput,
} from "@metabase/client/domain/permission";
import { renderSummary } from "../../output/render";
import { permissionsGraphRevisionView } from "../../output/views/permission";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "update-graph", description: "Update data permissions from a JSON graph" },
  details:
    "The body is `{revision, groups}` in the shape `mb permission graph` returns. Only the groups and databases it names change. `revision` must be the latest the server holds: read the graph, change it, and send it back, so a change someone made in between is never overwritten. Admins only.",
  requires: ["permission.updateGraph"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
  },
  inputSchema: PermissionsGraphUpdateInput,
  outputSchema: PermissionsGraphRevision,
  examples: [
    "mb permission update-graph --file graph.json",
    'mb permission update-graph --body \'{"revision":7,"groups":{"3":{"2":{"view-data":"blocked","create-queries":"no"}}}}\'',
    "mb permission graph --db 2 | jq '...' | mb permission update-graph",
  ],
  async run({ args, ctx, getClient, readBody }) {
    const body = await readBody({ flag: args.body, file: args.file });
    const client = await getClient();
    const result = await client.permission.updateGraph(body);
    renderSummary(
      result,
      permissionsGraphRevisionView,
      `Updated permissions (revision ${result.revision}).`,
      ctx,
    );
  },
});
