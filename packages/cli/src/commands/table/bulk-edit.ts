import {
  DATA_AUTHORITY_WITHDRAWAL_GATE,
  TableBulkEditFields,
  TableBulkEditInput,
  TableBulkEditResult,
  TableSelectors,
} from "@metabase/client/domain/table";
import { ConfigError } from "@metabase/client/errors";
import { featureAvailability } from "@metabase/client/version/features";
import { renderSummary } from "../../output/render";
import { tableBulkEditResultView } from "../../output/views/table";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

const WITHDRAWAL_FEATURE = DATA_AUTHORITY_WITHDRAWAL_GATE.feature;

const SELECTOR_KEYS = TableSelectors.keyof().options;
const EDIT_KEYS = TableBulkEditFields.keyof().options;

type SelectorKey = (typeof SELECTOR_KEYS)[number];
type EditKey = (typeof EDIT_KEYS)[number];

interface BulkEditPlan {
  selectors: SelectorKey[];
  edits: EditKey[];
}

// The server answers `{}` whether or not the selectors matched a table or the body set a field,
// so a body that does neither is refused here rather than acknowledged as an edit.
export function planBulkEdit(body: TableBulkEditInput): BulkEditPlan {
  const selectors = SELECTOR_KEYS.filter((key) => {
    const ids = body[key];
    return ids !== undefined && ids.length > 0;
  });
  if (selectors.length === 0) {
    throw new ConfigError(`select at least one table: ${SELECTOR_KEYS.join(", ")}`);
  }
  const edits = EDIT_KEYS.filter((key) => body[key] !== undefined);
  if (edits.length === 0) {
    throw new ConfigError(`set at least one field: ${EDIT_KEYS.join(", ")}`);
  }
  return { selectors, edits };
}

export default defineMetabaseCommand({
  meta: {
    name: "bulk-edit",
    description: "Set the same metadata on every table a selector picks out",
  },
  details: [
    `The body picks tables with any of \`table_ids\`, \`database_ids\` and \`schema_ids\` (\`<db-id>:<schema>\`, such as \`1:public\`), and sets any of \`data_authority\`, \`data_source\`, \`data_layer\`, \`entity_type\`, \`owner_email\` and \`owner_user_id\` on all of them. A body that picks or sets nothing is refused before the request. A configured \`data_authority\` can't go back to \`unconfigured\`, and \`data_source\` can't move to or from \`metabase-transform\`: a table that breaks either rule fails the call, though on a server with \`${WITHDRAWAL_FEATURE}\` (${featureAvailability(WITHDRAWAL_FEATURE)}) some tables may already have the new values. Without that feature, \`null\` for \`data_authority\` is refused (exit 2).`,
    "On a server with `tableUserValueWithdrawal`, `null` withdraws an edit. `data_source` and `data_layer` then read back empty, and `entity_type`, `owner_email`, `owner_user_id` and `data_authority` go back to the values Metabase keeps for the table: the entity type it derives from the table name, and the owner and data authority from before the upgrade (no owner and `unconfigured` for a table published then or created since). On an older server, `null` clears the field, and the next scheduled analysis overwrites `entity_type` with the name-derived type. A table that leaves the `hidden` data layer is synced again after the call returns.",
  ].join("\n\n"),
  requires: ["table.bulkEdit"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
  },
  inputSchema: TableBulkEditInput,
  outputSchema: TableBulkEditResult,
  examples: [
    'mb table bulk-edit --body \'{"table_ids":[42,43],"owner_email":"dba@example.com"}\'',
    'mb table bulk-edit --body \'{"schema_ids":["1:public"],"data_layer":"final"}\' --json',
    "cat edit.json | mb table bulk-edit",
  ],
  async run({ args, ctx, getClient, readBody }) {
    const body = await readBody({ flag: args.body, file: args.file });
    const plan = planBulkEdit(body);
    const client = await getClient();
    const result = await client.table.bulkEdit(body);
    renderSummary(
      result,
      tableBulkEditResultView,
      `Accepted ${plan.edits.join(", ")} for the tables selected by ${plan.selectors.join(", ")}; the server does not report which tables matched.`,
      ctx,
    );
  },
});
