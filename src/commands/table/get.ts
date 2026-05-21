import { z } from "zod";

import { Table, TableQueryMetadata, tableView } from "../../domain/table";
import { renderItem } from "../../output/render";
import { parseEnum } from "../../runtime/csv";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

const TableGetInclude = z.enum(["fields"]);

export default defineMetabaseCommand({
  meta: {
    name: "get",
    description: "Get a table by id; pass --include fields to bundle hydrated fields",
  },
  capabilities: { minVersion: 58, edition: "oss" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    include: {
      type: "string",
      description: `Hydrate related entities: ${TableGetInclude.options.join("|")}`,
    },
    id: { type: "positional", description: "Table id", required: true },
  },
  outputSchema: Table,
  examples: [
    "mb table get 42",
    "mb table get 42 --json",
    "mb table get 42 --include fields --json",
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const include = parseEnum(args.include, TableGetInclude, "--include");
    const client = await getClient();
    if (include === "fields") {
      const table = await client.requestParsed(
        TableQueryMetadata,
        `/api/table/${id}/query_metadata`,
      );
      renderItem(table, tableView, ctx);
      return;
    }
    const table = await client.requestParsed(Table, `/api/table/${id}`);
    renderItem(table, tableView, ctx);
  },
});
