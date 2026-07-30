import { UploadResult } from "@metabase/client/domain/upload";

import { renderSummary } from "../../output/render";
import { uploadResultView } from "../../output/views/upload";
import { readCsvFile, requireUploadFilePath } from "../../runtime/upload";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

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
    const client = await getClient();
    const result = await client.upload.createFromCsv(file, { collection_id: collectionId });
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
