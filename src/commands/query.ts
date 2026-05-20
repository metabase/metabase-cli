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
    description:
      'Run an MBQL 5 query (validates against the bundled schema first); --print-schema emits the schema for agent discovery, --dry-run validates without sending. Any non-MBQL 5 body — legacy MBQL 4 ({type:"query", …}), legacy native ({type:"native", …}), or any other non-{lib/type:"mbql/query"} shape — skips pre-flight automatically and is normalized server-side by lib-be/normalize-query. The bundled schema only models MBQL 5. Every clause options object carries a `lib/uuid` (UUID v4); mint these via `mb uuid` — never author them by hand.',
  },
  capabilities: { minVersion: 58, edition: "oss" },
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
