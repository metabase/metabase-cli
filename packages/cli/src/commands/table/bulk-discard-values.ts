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
  details: `Deletes the cached distinct values behind the filter dropdowns of every selected table, and with them any custom display values set on those values. No scan recreates a discarded set, neither \`mb table bulk-rescan-values\` nor the database's scheduled scan; Metabase rebuilds a set, without its display values, the next time it is read (a filter dropdown, \`mb field values <id>\`). Asks for confirmation on a terminal; pass --yes to skip it, which a non-interactive run must. ${SELECTION_DETAILS}`,
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
