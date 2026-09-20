import { renderSummary } from "../../output/render";
import { TableValuesDiscardResult, tableValuesDiscardResultView } from "../../output/views/table";
import { confirmDestructive } from "../delete-runtime";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: {
    name: "discard-values",
    description: "Discard the cached field values of one table",
  },
  details:
    "Deletes the cached distinct values behind this table's filter dropdowns, and with them any custom display values set on those values. No scan recreates a discarded set, neither `mb table rescan-values` nor the database's scheduled scan; Metabase rebuilds a set, without its display values, the next time it is read (a filter dropdown, `mb field values <id>`). Asks for confirmation on a terminal; pass --yes to skip it, which a non-interactive run must. To discard a set of tables use `mb table bulk-discard-values`.",
  requires: ["table.discardValues"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    yes: { type: "boolean", description: "Skip confirmation", default: false },
    id: { type: "positional", description: "Table id", required: true },
  },
  outputSchema: TableValuesDiscardResult,
  examples: ["mb table discard-values 42 --yes", "mb table discard-values 42"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const confirmed = await confirmDestructive({
      yes: args.yes,
      action: `discard the field values of table ${id}`,
      promptMessage: `Discard the cached field values of table ${id}, custom display values included?`,
    });
    if (!confirmed) {
      renderSummary(
        { id, discarded: false, aborted: true },
        tableValuesDiscardResultView,
        `Aborted; the field values of table ${id} were not discarded.`,
        ctx,
      );
      return;
    }
    await client.table.discardValues(id);
    renderSummary(
      { id, discarded: true, aborted: false },
      tableValuesDiscardResultView,
      `Cached field values discarded for table ${id}.`,
      ctx,
    );
  },
});
