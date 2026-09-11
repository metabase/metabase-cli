import { DataSensitivityDatabaseResult } from "@metabase/client/domain/data-sensitivity";

import { filterResult, formatDataSensitivityReport } from "../../output/data-sensitivity-report";
import { renderSummary } from "../../output/render";
import { dataSensitivityDatabaseView } from "../../output/views/data-sensitivity";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

import { parseScanFlags, scanFlags } from "./scan-flags";

const OVERSIZE_HINT =
  "narrow the scan with `--schema <name>`, keep fewer rows with `--status disagree,new`, raise " +
  "`--max-bytes`, or scan one table at a time with `mb data-sensitivity scan-table <table-id>`";

export default defineMetabaseCommand({
  meta: {
    name: "scan-db",
    description:
      "Propose a data sensitivity label for every field of a database with the LLM (dry run)",
  },
  details:
    'Dry run: nothing is written, the response is the proposal. For every active table (or only those in --schema) the server builds one packet of names, types, descriptions, fingerprints and a few sample values, asks the LLM for a label per field, and diffs each proposal against the field\'s current data_sensitivity label, which the model never sees. Statuses: agree, disagree, new (no current label yet), abstain (model unsure), dropped (no usable answer). The request is synchronous and runs as long as the scan, so raise --timeout for large databases; every request spends provider tokens. A table the server could not classify appears as an error entry and the run still exits 0. Apply a proposal with `mb field update <field-id> --body \'{"data_sensitivity":"PII"}\'`.',
  capabilities: { minVersion: 64, tokenFeature: "data_sensitivity" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...scanFlags,
    id: { type: "positional", description: "Database id", required: true },
    schema: { type: "string", description: "Scan only the tables in this schema" },
  },
  outputSchema: DataSensitivityDatabaseResult,
  examples: [
    "mb data-sensitivity scan-db 1",
    "mb data-sensitivity scan-db 1 --schema public",
    "mb data-sensitivity scan-db 1 --status disagree,new --json",
    "mb data-sensitivity scan-db 1 --json --fields counts,failed",
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const scan = parseScanFlags(args);
    const client = await getClient();
    const result = await client.dataSensitivity.classifyDatabase(
      id,
      { schema: args.schema },
      { timeoutMs: scan.timeoutMs },
    );
    renderSummary(
      filterResult(result, scan.statuses),
      dataSensitivityDatabaseView,
      () => formatDataSensitivityReport(result, scan.statuses),
      { ...ctx, oversizeHint: OVERSIZE_HINT },
    );
  },
});
