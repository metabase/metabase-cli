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

const ExportFormat = z.enum(["csv", "json", "xlsx"]);
type ExportFormat = z.infer<typeof ExportFormat>;

const QueryParameters = z.array(z.unknown());

interface StreamExportOptions {
  format: ExportFormat;
  parameters: unknown[];
  formatRows: boolean;
  pivotResults: boolean;
}

export default defineMetabaseCommand({
  meta: {
    name: "query",
    description:
      "Run a saved card and return results (json envelope, or stream CSV/JSON/XLSX via --export-format)",
  },
  capabilities: { minVersion: 58, edition: "oss" },
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
      description: "Cap rows kept in the JSON envelope (no effect on streamed exports)",
    },
    "format-rows": {
      type: "boolean",
      description:
        "Streamed exports only: apply visualization-settings formatting to values (default false)",
      default: false,
    },
    "pivot-results": {
      type: "boolean",
      description:
        "Streamed exports only: emit the pivoted output for pivot questions (default false)",
      default: false,
    },
  },
  outputSchema: CardQueryResult,
  examples: [
    "mb card query 1",
    "mb card query 1 --json --limit 20",
    "mb card query 1 --export-format csv > results.csv",
    'mb card query 1 --parameters \'[{"type":"category","value":"A","target":["variable",["template-tag","c"]]}]\'',
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const parameters = parseParameters(args.parameters);
    const client = await getClient();

    const exportFormatRaw = args["export-format"];
    if (exportFormatRaw !== undefined && exportFormatRaw !== "") {
      await streamExport(client, id, {
        format: parseExportFormat(exportFormatRaw),
        parameters,
        formatRows: args["format-rows"],
        pivotResults: args["pivot-results"],
      });
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
  if (limit === null || result.data === undefined || result.data.rows.length <= limit) {
    return result;
  }
  return { ...result, data: { ...result.data, rows: result.data.rows.slice(0, limit) } };
}

async function streamExport(
  client: Client,
  id: number,
  options: StreamExportOptions,
): Promise<void> {
  const body = new URLSearchParams({
    parameters: JSON.stringify(options.parameters),
    format_rows: String(options.formatRows),
    pivot_results: String(options.pivotResults),
  });
  const stream = await client.requestStream(`/api/card/${id}/query/${options.format}`, {
    method: "POST",
    body,
  });
  await pipeToStdout(stream);
}
