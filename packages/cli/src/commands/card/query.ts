import { z } from "zod";

import { CardExportFormat, CardQueryResult } from "@metabase/client/domain/card";
import { ConfigError } from "@metabase/client/errors";
import { parseJson } from "@metabase/client/json";

import { formatQueryResult } from "../../output/query-result";
import { renderSummary } from "../../output/render";
import { pipeToStdout } from "../../output/stream";
import { cardQueryView } from "../../output/views/card";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { parseOptionalInteger } from "../parse-integer";
import { defineMetabaseCommand } from "../runtime";

const QueryParameters = z.array(z.unknown());

export default defineMetabaseCommand({
  meta: {
    name: "query",
    description:
      "Run a saved card and return results (json envelope, or stream CSV/JSON/XLSX via --export-format)",
  },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Card id", required: true },
    "export-format": {
      type: "string",
      description: `Bypass JSON envelope and stream raw export: ${CardExportFormat.options.join(" | ")}`,
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
      const stream = await client.card.exportQuery(id, parseExportFormat(exportFormatRaw), {
        parameters,
        format_rows: args["format-rows"],
        pivot_results: args["pivot-results"],
      });
      await pipeToStdout(stream);
      return;
    }

    const result = await client.card.query(id, { parameters });
    const limit = parseOptionalInteger(args.limit, { name: "--limit", min: 1 });
    const limited = applyLimit(result, limit);
    renderSummary(limited, cardQueryView, () => formatQueryResult(limited), ctx);
  },
});

function parseParameters(raw: string | undefined): unknown[] {
  if (raw === undefined || raw === "") {
    return [];
  }
  return parseJson(raw, QueryParameters, { source: "--parameters" });
}

function parseExportFormat(raw: string): CardExportFormat {
  const result = CardExportFormat.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(
      `invalid --export-format: "${raw}" (expected: ${CardExportFormat.options.join(", ")})`,
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
