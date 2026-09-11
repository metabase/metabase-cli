import { DataSensitivityTableResult } from "@metabase/client/domain/data-sensitivity";

import { filterResult, formatDataSensitivityReport } from "../../output/data-sensitivity-report";
import { renderSummary } from "../../output/render";
import { dataSensitivityTableView } from "../../output/views/data-sensitivity";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

import { parseScanFlags, scanFlags } from "./scan-flags";

export default defineMetabaseCommand({
  meta: {
    name: "scan-table",
    description:
      "Propose a data sensitivity label for every field of a table with the LLM (dry run)",
  },
  details:
    "Dry run: nothing is written, the response is the proposal. The server builds one packet of the table's names, types, descriptions, fingerprints and a few sample values, asks the LLM for a label per field, and diffs each proposal against the field's current data_sensitivity label, which the model never sees. Statuses: agree, disagree, new (no current label yet), abstain (model unsure), dropped (no usable answer). The request is synchronous and spends provider tokens. Apply a proposal with `mb field update <field-id> --body '{\"data_sensitivity\":\"PII\"}'`.",
  capabilities: { minVersion: 64, tokenFeature: "data_sensitivity" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...scanFlags,
    id: { type: "positional", description: "Table id", required: true },
  },
  outputSchema: DataSensitivityTableResult,
  examples: [
    "mb data-sensitivity scan-table 3",
    "mb data-sensitivity scan-table 3 --status disagree,new --json",
    "mb data-sensitivity scan-table 3 --json --fields counts,usage",
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const scan = parseScanFlags(args);
    const client = await getClient();
    const result = await client.dataSensitivity.classifyTable(id, { timeoutMs: scan.timeoutMs });
    renderSummary(
      filterResult(result, scan.statuses),
      dataSensitivityTableView,
      () => formatDataSensitivityReport(result, scan.statuses),
      ctx,
    );
  },
});
