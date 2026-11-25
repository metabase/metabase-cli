import { ContentTranslationUploadResult } from "@metabase/client/domain/content-translation";

import { renderSummary } from "../../output/render";
import { contentTranslationUploadView } from "../../output/views/content-translation";
import { readCsvFile, requireUploadFilePath } from "../../runtime/upload";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: {
    name: "upload",
    description: "Replace the complete content translation dictionary from CSV",
  },
  details:
    "Replaces every active content translation. Download the current dictionary first, and keep the full CSV in version control. Metabase accepts dictionaries up to 1.5 MiB.",
  requires: ["contentTranslation.upload"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    file: {
      type: "string",
      description: "Path to the complete translation dictionary CSV (required)",
    },
  },
  outputSchema: ContentTranslationUploadResult,
  examples: [
    "mb content-translation upload --file translations.csv",
    "mb content-translation upload --file translations.csv --profile prod --json",
  ],
  async run({ args, ctx, getClient }) {
    const file = await readCsvFile(requireUploadFilePath(args.file));
    const mb = await getClient();
    const result = await mb.contentTranslation.upload(file);
    renderSummary(
      result,
      contentTranslationUploadView,
      `Replaced the content translation dictionary with "${file.filename}".`,
      ctx,
    );
  },
});
