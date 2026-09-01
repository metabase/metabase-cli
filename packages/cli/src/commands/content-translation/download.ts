import { z } from "zod";

import { pipeToStdout } from "../../output/stream";
import { connectionFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

const ContentTranslationCsv = z.string().describe("The raw content translation dictionary CSV.");

export default defineMetabaseCommand({
  meta: {
    name: "download",
    description: "Stream the complete content translation dictionary as CSV",
  },
  details:
    "Streams the active dictionary to stdout with the server's CSV formatting. Redirect stdout to preserve it as a file that can be reviewed, versioned, or uploaded later. An empty dictionary downloads as Metabase's four-row sample dictionary, not a header-only file.",
  capabilities: { minVersion: 58, tokenFeature: "content_translation" },
  args: {
    ...profileFlag,
    ...connectionFlags,
  },
  outputSchema: ContentTranslationCsv,
  examples: [
    "mb content-translation download > metabase-content-translations.csv",
    "mb content-translation download --profile prod > translations.csv",
  ],
  async run({ getClient }) {
    const mb = await getClient();
    const stream = await mb.contentTranslation.download();
    await pipeToStdout(stream);
  },
});
