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
    "Deletes this table's cached filter values, with their custom display values. No scan brings them back: Metabase rebuilds the values, without display values, the next time something reads them (a filter dropdown, or `mb field values <id>`). Pass `--yes` to skip the confirmation, which a non-interactive run must. Returns `{ id, discarded, aborted }`. For several tables, use `mb table bulk-discard-values`.",
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
