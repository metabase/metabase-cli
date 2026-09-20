import {
  TableBulkEditFields,
  TableBulkEditInput,
  TableBulkEditResult,
  TableSelectors,
} from "@metabase/client/domain/table";
import { ConfigError } from "@metabase/client/errors";
import { renderSummary } from "../../output/render";
import { tableBulkEditResultView } from "../../output/views/table";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

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
  details:
    'The body selects tables with any of `table_ids`, `database_ids`, and `schema_ids` (each schema id is "<db-id>:<schema>", e.g. 1:public; the selectors are unioned) and sets any of `data_authority`, `data_source`, `data_layer`, `entity_type`, `owner_email`, `owner_user_id` on all of them. A configured `data_authority` cannot be set back to "unconfigured", and `data_source` never moves to or from "metabase-transform". A selected table that breaks either rule fails the call: before Metabase 64 no table is edited, while on 64 the selected tables Metabase held no user edits for may already carry the new values. Before Metabase 64, `null` clears a field, `null` for `data_authority` is refused before any request, and the next scheduled analysis overwrites `entity_type` with the type it derives from the table name. On Metabase 64, `null` withdraws the edit: `data_source` and `data_layer` read back empty, while `entity_type`, `owner_email`, `owner_user_id`, and `data_authority` fall back to the values Metabase keeps for the table, which are the name-derived entity type and the owner and data authority from before the upgrade (no owner and "unconfigured" for a table published then or created since). A table leaving the `hidden` data layer is re-synced after the call returns. The server answers the same whether or not a selector matched a table, so the output restates the accepted request and cannot say which tables were edited.',
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
  async run({ args, ctx, getClient }) {
    const body = await readBody({ flag: args.body, file: args.file }, TableBulkEditInput);
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
