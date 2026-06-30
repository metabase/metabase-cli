import { z } from "zod";

import type { ResourceView } from "../../domain/view";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

import { parseTableSelectors, tableSelectorFlags } from "./selectors";

export const TableUnpublishResult = z.object({
  unpublished: z.literal(true),
  table_ids: z.array(z.number().int()).optional(),
  database_ids: z.array(z.number().int()).optional(),
  schema_ids: z.array(z.string()).optional(),
});
type TableUnpublishResultJson = z.infer<typeof TableUnpublishResult>;

const tableUnpublishResultView: ResourceView<TableUnpublishResultJson> = {
  compactPick: TableUnpublishResult,
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
    description: "Unpublish tables (and their downstream dependents) from the library",
  },
  details:
    'Clears the library collection for each selected table and recursively for every downstream table that depends on it. Select tables with --table-ids, whole databases with --db-ids, or schemas with --schemas (each schema id is "<db-id>:<schema>", e.g. 1:public); the filters are combined.',
  capabilities: { minVersion: 58, tokenFeature: "library" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...tableSelectorFlags,
  },
  outputSchema: TableUnpublishResult,
  examples: [
    "mb table unpublish --table-ids 1,2,3",
    "mb table unpublish --db-ids 1 --json",
    "mb table unpublish --schemas 1:public,1:analytics",
  ],
  async run({ args, ctx, getClient }) {
    const selectors = parseTableSelectors(args);

    const client = await getClient();
    await client.requestRaw("/api/ee/data-studio/table/unpublish-tables", {
      method: "POST",
      body: selectors,
      expectContentType: "binary",
    });

    const result: TableUnpublishResultJson = { unpublished: true, ...selectors };
    renderSummary(result, tableUnpublishResultView, "Unpublished tables from the library.", ctx);
  },
});
