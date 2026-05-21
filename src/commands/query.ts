import { z } from "zod";

import { ConfigError } from "../core/errors";
import {
  assertNotLegacyEnvelopeWrappingMbql5,
  getQuerySchemaBundle,
  isMbql5Query,
  validateQuery,
} from "../core/schema/validate";
import { CardQueryResult, cardQueryView } from "../domain/card";
import { renderItem, writeJson } from "../output/render";
import { readBody } from "../runtime/body";

import { bodyInputFlags } from "./body-flags";
import { connectionFlags, outputFlags, profileFlag } from "./flags";
import { defineMetabaseCommand } from "./runtime";
import { skipValidateFlag } from "./validate-query";

const QueryBody = z.unknown();

const QUERY_ENDPOINT = "/api/dataset";

export default defineMetabaseCommand({
  meta: {
    name: "query",
    description: "Run an ad-hoc MBQL or native query",
  },
  details:
    'Reads a JSON query body from --body, --file, or stdin and runs it. MBQL 5 is Metabase\'s structured query format, shaped {"lib/type":"mbql/query", "database": <id>, "stages": [...]}; it is checked against a bundled JSON Schema before sending — --print-schema prints that schema, and --dry-run reports any errors as {ok, errors:[{path, message}]} and exits 2 without sending. Legacy MBQL 4 and native-SQL bodies are not checked and run as-is. Run `mb skills get mbql` for the body shape, clause rules, and the iterate-with-dry-run loop.',
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    "dry-run": {
      type: "boolean",
      description: "Validate the body and exit without sending the query",
    },
    "print-schema": {
      type: "boolean",
      description: "Emit the bundled MBQL 5 query JSON Schema and exit; no body required",
    },
    ...skipValidateFlag,
  },
  outputSchema: CardQueryResult,
  examples: [
    "mb query --print-schema",
    "cat q.json | mb query --dry-run",
    "mb query --file q.json",
    "mb query --file q.json --skip-validate",
  ],
  async run({ args, ctx, getClient }) {
    if (args["print-schema"] === true) {
      writeJson(getQuerySchemaBundle());
      return;
    }

    const dryRun = args["dry-run"] === true;
    const explicitSkip = args["skip-validate"] === true;
    if (dryRun && explicitSkip) {
      throw new ConfigError("--skip-validate cannot be combined with --dry-run");
    }

    const body = await readBody({ flag: args.body, file: args.file }, QueryBody);

    if (!explicitSkip) {
      assertNotLegacyEnvelopeWrappingMbql5(body, { contextLabel: "query", bodyNoun: "the body" });
    }

    const skipValidation = explicitSkip || !isMbql5Query(body);

    if (!skipValidation) {
      const outcome = validateQuery(body);
      if (!outcome.ok) {
        writeJson(outcome);
        const hint = dryRun ? "" : " — pass --dry-run to validate without sending";
        throw new ConfigError(`validation failed: ${outcome.errors.length} error(s)${hint}`);
      }
      if (dryRun) {
        writeJson(outcome);
        return;
      }
    } else if (dryRun) {
      writeJson({ ok: true, errors: [] });
      return;
    }

    const client = await getClient();
    const queryResult = await client.requestParsed(CardQueryResult, QUERY_ENDPOINT, {
      method: "POST",
      body,
    });
    renderItem(queryResult, cardQueryView, ctx);
  },
});
