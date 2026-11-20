import { z } from "zod";

import { CardQueryResult } from "@metabase/client/domain/card";
import { ConfigError } from "@metabase/client/errors";
import { parseJson } from "@metabase/client/json";

import { formatQueryResult } from "../../output/query-result";
import { renderSummary } from "../../output/render";
import { pipeToStdout } from "../../output/stream";
import { cardQueryView } from "../../output/views/card";
import { assertStreamedOutput, exportFlags, readExportRequest } from "../export-flags";
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
  details:
    "Without `--export-format`, prints Metabase's result envelope (`status`, `row_count`, `data: { rows, cols }`, …), whose rows stop at the server's row limit for an API run: when the server cut them, `data.rows_truncated` (`pivot_rows_truncated` for a pivot) carries the limit and the text summary says so. A result served from the cache carries the time it was computed in `cached`. With `--export-format`, the export bytes stream straight to stdout, capped at the server's download row limit; `--full`, `--fields`, `--max-bytes` and `--limit` are refused, since they shape only the JSON output, and `--json` and `--format` still pick the shape of an error. `--format-rows`, `--pivot-results` and `--csv-include-bom` are refused without `--export-format`.",
  requires: ["card.exportQuery", "card.query"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Card id", required: true },
    ...exportFlags,
    parameters: {
      type: "string",
      description:
        "JSON array of Metabase parameter objects to pass with the query, in the shape Metabase sends from a dashboard",
    },
    limit: {
      type: "string",
      description: "Cap rows kept in the JSON envelope; refused with --export-format",
    },
    "ignore-cache": {
      type: "boolean",
      description:
        "Run the query against the database even when a cached result would be served; refused with --export-format",
      default: false,
    },
  },
  outputSchema: CardQueryResult,
  examples: [
    "mb card query 1",
    "mb card query 1 --json --limit 20",
    "mb card query 1 --ignore-cache",
    "mb card query 1 --export-format csv > results.csv",
    "mb card query 1 --export-format json > results.json",
    "mb card query 1 --export-format xlsx > results.xlsx",
    'mb card query 1 --parameters \'[{"type":"category","value":"A","target":["variable",["template-tag","c"]]}]\'',
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const parameters = parseParameters(args.parameters);
    const exportRequest = readExportRequest(args);

    if (exportRequest !== null) {
      assertStreamedOutput(ctx);
      if (args["ignore-cache"]) {
        throw new ConfigError(
          "--ignore-cache has no effect with --export-format: an export always runs the query against the database",
        );
      }
      const client = await getClient();
      const stream = await client.card.exportQuery(id, exportRequest.format, {
        parameters,
        ...exportRequest.params,
      });
      await pipeToStdout(stream);
      return;
    }

    const client = await getClient();
    const result = await client.card.query(id, {
      parameters,
      ignore_cache: args["ignore-cache"],
    });
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

function applyLimit(result: CardQueryResult, limit: number | null): CardQueryResult {
  if (limit === null || result.data === undefined || result.data.rows.length <= limit) {
    return result;
  }
  return { ...result, data: { ...result.data, rows: result.data.rows.slice(0, limit) } };
}
