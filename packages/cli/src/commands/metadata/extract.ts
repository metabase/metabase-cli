import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

import { MetadataExport } from "@metabase/client/domain/metadata-export";
import { parseJson } from "@metabase/client/json";

import { extractTableMetadata } from "../../core/metadata/extract";
import { spoolExport, writeExtractedTree } from "../../core/metadata/write-tree";
import { renderSummary } from "../../output/render";
import type { ResourceView } from "../../output/view";
import { parseCsv } from "../../runtime/csv";
import { interruptSignal } from "../../runtime/interrupt";
import { outputFlags, preflightFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

const DEFAULT_OUT_DIR = ".metadata";

export const MetadataExtractResult = z.object({
  databases: z.number().int(),
  tables: z.number().int(),
  fields: z.number().int(),
  out: z.string(),
  export_file: z.string(),
});
type MetadataExtractResult = z.infer<typeof MetadataExtractResult>;

const metadataExtractResultView: ResourceView<MetadataExtractResult> = {
  compactPick: MetadataExtractResult,
  tableColumns: [
    { key: "databases", label: "Databases" },
    { key: "tables", label: "Tables" },
    { key: "fields", label: "Fields" },
    { key: "out", label: "Output" },
  ],
};

function parseDatabaseNames(value: string | undefined): string[] | null {
  if (value === undefined || value === "") {
    return null;
  }
  const names = parseCsv(value);
  return names.length === 0 ? null : names;
}

export default defineMetabaseCommand({
  meta: {
    name: "extract",
    description:
      "Export the warehouse metadata and write it as one YAML file per database and table",
  },
  details:
    "Downloads the connected Metabase's databases, tables and fields to `<out>/table_metadata.json`, then writes the tree under `<out>/databases/` (one file per database, one per table with its fields inline) in the database-metadata format. The `databases/` subtree is replaced on every run.",
  requires: ["metadataExport.download"],
  args: {
    ...outputFlags,
    ...preflightFlag,
    out: {
      type: "string",
      description: "Output directory",
      default: DEFAULT_OUT_DIR,
    },
    databases: {
      type: "string",
      description: "Only these databases, by name, comma separated (default: every database)",
    },
  },
  outputSchema: MetadataExtractResult,
  examples: [
    "mb metadata extract",
    "mb metadata extract --out .metadata --databases 'Sample Database' --json",
  ],
  async run({ args, ctx, getClient }) {
    const outDir = resolve(args.out);
    const databases = parseDatabaseNames(args.databases);
    const client = await getClient();
    const stream = await client.metadataExport.download({
      "with-databases": true,
      "with-tables": true,
      "with-fields": true,
    });
    const exportFile = await spoolExport(outDir, stream, { signal: interruptSignal });
    const metadata = parseJson(await fs.readFile(exportFile, "utf8"), MetadataExport, {
      source: exportFile,
    });
    const tree = extractTableMetadata(metadata, { databases });
    const root = await writeExtractedTree(outDir, tree);
    const result: MetadataExtractResult = { ...tree.stats, out: root, export_file: exportFile };
    renderSummary(
      result,
      metadataExtractResultView,
      `Extracted ${result.databases} database(s), ${result.tables} table(s) and ${result.fields} field(s) to ${root}.`,
      ctx,
    );
  },
});
