import { z } from "zod";

import type { ResourceView } from "../../domain/view";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

import { parseTableSelectors, tableSelectorFlags } from "./selectors";

const UNPUBLISH_TABLES_PATH = "/api/ee/data-studio/table/unpublish-tables";

export const LibraryUnpublishResult = z.object({
  unpublished: z.literal(true),
  table_ids: z.array(z.number().int()).optional(),
  database_ids: z.array(z.number().int()).optional(),
  schema_ids: z.array(z.string()).optional(),
});
type LibraryUnpublishResultJson = z.infer<typeof LibraryUnpublishResult>;

const libraryUnpublishResultView: ResourceView<LibraryUnpublishResultJson> = {
  compactPick: LibraryUnpublishResult,
  tableColumns: [
    { key: "unpublished", label: "Unpublished" },
    { key: "table_ids", label: "Tables" },
    { key: "database_ids", label: "Databases" },
    { key: "schema_ids", label: "Schemas" },
  ],
};

export default defineMetabaseCommand({
  meta: {
    name: "unpublish",
    description: "Unpublish tables (and their downstream dependents) from the Library",
  },
  details:
    'Clears the Library collection for each selected table and recursively for every downstream table that depends on it. Select with --table-ids, --db-ids, or --schemas (each schema id is "<db-id>:<schema>", e.g. 1:public); the filters are combined.',
  capabilities: { minVersion: 59, tokenFeature: "library" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...tableSelectorFlags,
  },
  outputSchema: LibraryUnpublishResult,
  examples: [
    "mb library unpublish --table-ids 1,2,3",
    "mb library unpublish --db-ids 1 --json",
    "mb library unpublish --schemas 1:public,1:analytics",
  ],
  async run({ args, ctx, getClient }) {
    const selectors = parseTableSelectors(args);

    const client = await getClient();
    await client.requestRaw(UNPUBLISH_TABLES_PATH, {
      method: "POST",
      body: selectors,
      expectContentType: "binary",
    });

    const result: LibraryUnpublishResultJson = { unpublished: true, ...selectors };
    renderSummary(result, libraryUnpublishResultView, "Unpublished tables from the Library.", ctx);
  },
});
