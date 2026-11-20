import { z } from "zod";

import type { ResourceView } from "../../output/view";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

import { parseTableSelectors, tableSelectorFlags } from "../table-selector-flags";

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
    "Removes each selected table, and every downstream table that depends on it, from the Library. The selectors are combined.",
  requires: ["library.unpublishTables"],
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
    await client.library.unpublishTables(selectors);

    const result: LibraryUnpublishResultJson = { unpublished: true, ...selectors };
    renderSummary(result, libraryUnpublishResultView, "Unpublished tables from the Library.", ctx);
  },
});
