import { renderSummary } from "../../output/render";
import { buildCsvFormData, readCsvFile, requireUploadFilePath } from "../../runtime/upload";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

import { parseCreateUploadResult } from "./requests";
import { UploadResult, uploadResultView } from "./results";

const UPLOAD_CSV_PATH = "/api/upload/csv";
const ROOT_COLLECTION = "root";

export default defineMetabaseCommand({
  meta: { name: "csv", description: "Upload a CSV file as a new table and model" },
  details:
    "Uploads the CSV to the server's configured uploads database, creating a new table plus a model over it, and prints the new model id and table id. Requires an uploads database to be configured on the server. Pass --collection to place the model in a specific collection (defaults to root).",
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    file: { type: "string", description: "Path to the CSV/TSV file to upload" },
    collection: { type: "string", description: "Target collection id, or 'root' (default: root)" },
  },
  outputSchema: UploadResult,
  examples: [
    "mb upload csv --file data.csv",
    "mb upload csv --file data.csv --collection 5",
    "mb upload csv --file data.csv --json",
  ],
  async run({ args, ctx, getClient }) {
    const collectionId = resolveCollection(args.collection);
    const file = await readCsvFile(requireUploadFilePath(args.file));
    const form = buildCsvFormData(file);
    form.append("collection_id", collectionId);
    const client = await getClient();
    const response = await client.requestRaw(UPLOAD_CSV_PATH, {
      method: "POST",
      body: form,
      expectContentType: "binary",
    });
    const result = parseCreateUploadResult(await response.text(), response.headers);
    renderSummary(
      result,
      uploadResultView,
      `Uploaded "${file.filename}" — created model ${result.model_id} (table ${result.table_id}).`,
      ctx,
    );
  },
});

function resolveCollection(collection: string | undefined): string {
  if (typeof collection !== "string" || collection === "" || collection === ROOT_COLLECTION) {
    return ROOT_COLLECTION;
  }
  return String(parseId(collection, "collection id"));
}
