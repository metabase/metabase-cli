import { z } from "zod";

import { CardQueryResult, cardQueryView } from "../../domain/card";
import { ConfigError } from "../../core/errors";
import type { Client } from "../../core/http/client";
import { renderItem } from "../../output/render";
import { pipeToStdout } from "../../output/stream";
import { parseJson } from "../../runtime/json";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

const ExportFormat = z.enum(["csv", "xlsx"]);
type ExportFormat = z.infer<typeof ExportFormat>;

const QueryParameters = z.array(z.unknown());

export default defineMetabaseCommand({
  meta: {
    name: "query",
    description: "Run a saved card and return results (json envelope, CSV, or XLSX)",
  },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Card id", required: true },
    "export-format": {
      type: "string",
      description: `Bypass JSON envelope and stream raw export: ${ExportFormat.options.join(" | ")}`,
    },
    parameters: {
      type: "string",
      description: "JSON array of Metabase parameter objects to pass with the query",
    },
    limit: {
      type: "string",
      description: "Cap rows kept in the JSON envelope (no effect on csv/xlsx exports)",
    },
  },
  outputSchema: CardQueryResult,
  examples: [
    "metabase card query 1",
    "metabase card query 1 --json --limit 20",
    "metabase card query 1 --export-format csv > results.csv",
    'metabase card query 1 --parameters \'[{"type":"category","value":"A","target":["variable",["template-tag","c"]]}]\'',
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const parameters = parseParameters(args.parameters);
    const client = await getClient();

    const exportFormatRaw = args["export-format"];
    if (exportFormatRaw !== undefined && exportFormatRaw !== "") {
      const exportFormat = parseExportFormat(exportFormatRaw);
      await streamExport(client, id, exportFormat, parameters);
      return;
    }

    const result = await client.requestParsed(CardQueryResult, `/api/card/${id}/query`, {
      method: "POST",
      body: { parameters },
    });
    const limit =
      args.limit === undefined || args.limit === "" ? null : parseId(args.limit, "limit");
    renderItem(applyLimit(result, limit), cardQueryView, ctx);
  },
});

function parseParameters(raw: string | undefined): unknown[] {
  if (raw === undefined || raw === "") {
    return [];
  }
  return parseJson(raw, QueryParameters, { source: "--parameters" });
}

function parseExportFormat(raw: string): ExportFormat {
  const result = ExportFormat.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(
      `invalid --export-format: "${raw}" (expected: ${ExportFormat.options.join(", ")})`,
    );
  }
  return result.data;
}

function applyLimit(result: CardQueryResult, limit: number | null): CardQueryResult {
  if (limit === null || result.status !== "completed" || result.data.rows.length <= limit) {
    return result;
  }
  return { ...result, data: { ...result.data, rows: result.data.rows.slice(0, limit) } };
}

async function streamExport(
  client: Client,
  id: number,
  format: ExportFormat,
  parameters: unknown[],
): Promise<void> {
  const body = new URLSearchParams({ parameters: JSON.stringify(parameters) });
  const stream = await client.requestStream(`/api/card/${id}/query/${format}`, {
    method: "POST",
    body,
  });
  await pipeToStdout(stream);
}
