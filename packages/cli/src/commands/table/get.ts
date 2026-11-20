import { Table, TableGetInclude } from "@metabase/client/domain/table";
import { tableView } from "../../output/views/table";
import { renderItem } from "../../output/render";
import { parseEnum } from "../../runtime/csv";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

import { tableFieldsOversizeHint } from "./hints";

export default defineMetabaseCommand({
  meta: {
    name: "get",
    description: "Get a table by id; pass --include fields to bundle hydrated fields",
  },
  details:
    "Without `--include`, returns the table record without its fields. `--include fields` reads the table's query metadata, so the result carries its columns compact-projected as `fields`, with each field's FK `target` and `dimensions` under `--full`: the default path for field introspection. `mb table fields <id>` returns the fields alone, as a list envelope.",
  requires: ["table.queryMetadata", "table.get"],
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
      const table = await client.table.queryMetadata(id);
      renderItem(table, tableView, { ...ctx, oversizeHint: tableFieldsOversizeHint(id) });
      return;
    }
    const table = await client.table.get(id);
    renderItem(table, tableView, ctx);
  },
});
