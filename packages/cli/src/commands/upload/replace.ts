import { renderSummary } from "../../output/render";
import { readCsvFile, requireUploadFilePath } from "../../runtime/upload";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

import { updateTableFromCsv } from "./requests";
import { UploadUpdateResult, uploadUpdateResultView } from "./results";

export default defineMetabaseCommand({
  meta: {
    name: "replace",
    description: "Replace an existing uploaded table's rows with a CSV file",
  },
  details:
    "Replaces the contents of the table with the given id with the rows of the CSV. The table must have been created by a CSV upload and the CSV columns must match.",
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    file: { type: "string", description: "Path to the CSV/TSV file to upload" },
    id: { type: "positional", description: "Target table id", required: true },
  },
  outputSchema: UploadUpdateResult,
  examples: ["mb upload replace 42 --file rows.csv", "mb upload replace 42 --file rows.csv --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const file = await readCsvFile(requireUploadFilePath(args.file));
    const client = await getClient();
    const result = await updateTableFromCsv(client, id, "replace", file);
    renderSummary(
      result,
      uploadUpdateResultView,
      `Replaced table ${id} with "${file.filename}".`,
      ctx,
    );
  },
});
