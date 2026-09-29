import { z } from "zod";

import { CardQueryResult } from "@metabase/client/domain/card";
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
  requires: ["card.exportQuery", "card.query"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Card id", required: true },
    ...exportFlags,
    parameters: {
      type: "string",
      description: "JSON array of Metabase parameter objects to pass with the query",
    },
    limit: {
      type: "string",
      description: "Cap rows kept in the JSON envelope; refused with --export-format",
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
    const exportRequest = readExportRequest(args);

    if (exportRequest !== null) {
      assertStreamedOutput(ctx);
      const client = await getClient();
      const stream = await client.card.exportQuery(id, exportRequest.format, {
        parameters,
        ...exportRequest.params,
      });
      await pipeToStdout(stream);
      return;
    }

    const client = await getClient();
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

function applyLimit(result: CardQueryResult, limit: number | null): CardQueryResult {
  if (limit === null || result.data === undefined || result.data.rows.length <= limit) {
    return result;
  }
  return { ...result, data: { ...result.data, rows: result.data.rows.slice(0, limit) } };
}
