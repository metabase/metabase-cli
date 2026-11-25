import { renderSummary } from "../../output/render";
import {
  TableSelectionDiscardResult,
  tableSelectionDiscardResultView,
} from "../../output/views/table";
import { confirmDestructive } from "../delete-runtime";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import {
  parseTableSelectors,
  SELECTION_DETAILS,
  selectionSummary,
  tableSelectorFlags,
} from "../table-selector-flags";

export default defineMetabaseCommand({
  meta: {
    name: "bulk-discard-values",
    description: "Discard the cached field values of every table a selector picks out",
  },
  details: `Runs [\`mb table discard-values\`](#mb-table-discard-values) on every selected table: no scan brings the values back. A declined confirmation sends nothing and returns \`accepted: false, aborted: true\`. ${SELECTION_DETAILS}`,
  requires: ["table.bulkDiscardValues"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...tableSelectorFlags,
    yes: { type: "boolean", description: "Skip confirmation", default: false },
  },
  outputSchema: TableSelectionDiscardResult,
  examples: [
    "mb table bulk-discard-values --table-ids 42,43 --yes",
    "mb table bulk-discard-values --schemas 1:staging --yes --json",
  ],
  async run({ args, ctx, getClient }) {
    const selectors = parseTableSelectors(args);
    const client = await getClient();
    const confirmed = await confirmDestructive({
      yes: args.yes,
      action: "discard the field values of the selected tables",
      promptMessage:
        "Discard the cached field values of every selected table, custom display values included?",
    });
    if (!confirmed) {
      renderSummary(
        { accepted: false, aborted: true, ...selectors },
        tableSelectionDiscardResultView,
        "Aborted; no field values were discarded.",
        ctx,
      );
      return;
    }
    const result = await client.table.bulkDiscardValues(selectors);
    renderSummary(
      { ...result, aborted: false },
      tableSelectionDiscardResultView,
      selectionSummary("Field-values discard", selectors),
      ctx,
    );
  },
});
