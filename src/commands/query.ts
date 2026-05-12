import { z } from "zod";

import { ConfigError } from "../core/errors";
import {
  assertNotLegacyEnvelopeWrappingMbql5,
  getQuerySchemaBundle,
  isLegacyNativeQuery,
  validateExternalQuery,
  validateInternalQuery,
} from "../core/schema/validate";
import { CardQueryResult, cardQueryView } from "../domain/card";
import { renderItem, writeJson } from "../output/render";
import { readBody } from "../runtime/body";

import { bodyInputFlags } from "./body-flags";
import { connectionFlags, outputFlags, profileFlag } from "./flags";
import { defineMetabaseCommand } from "./runtime";
import { skipValidateFlag } from "./validate-query";

const QueryBody = z.unknown();

const INTERNAL = {
  mode: "internal",
  validate: validateInternalQuery,
  endpoint: "/api/dataset",
} as const;
const EXTERNAL = {
  mode: "external",
  validate: validateExternalQuery,
  endpoint: "/api/dataset/external",
} as const;

export default defineMetabaseCommand({
  meta: {
    name: "query",
    description:
      'Run an MBQL 5 query (validates against the bundled schema first); --print-schema emits the schema for agent discovery, --dry-run validates without sending. Default is internal MBQL (numeric IDs); pass --external for the representations / string-FK form. Legacy native bodies ({type:"native", …} or any top-level `native:`) skip pre-flight automatically — the bundled schema only models MBQL 5. Every clause options object carries a `lib/uuid` (UUID v4); mint these via `metabase uuid` — never author them by hand.',
  },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    external: {
      type: "boolean",
      description:
        "Validate as external MBQL (string FKs) and POST to /api/dataset/external; default is internal (numeric IDs) → /api/dataset",
    },
    "dry-run": {
      type: "boolean",
      description: "Validate the body and exit without sending the query",
    },
    "print-schema": {
      type: "boolean",
      description:
        "Emit the bundled MBQL 5 query JSON Schema (with --external for the string-FK variant) and exit; no body required",
    },
    ...skipValidateFlag,
  },
  outputSchema: CardQueryResult,
  examples: [
    "metabase query --print-schema",
    "metabase query --print-schema --external",
    "cat q.json | metabase query --dry-run",
    "metabase query --file q.json",
    "metabase query --file q.json --external",
    "metabase query --file q.json --skip-validate",
  ],
  async run({ args, ctx, getClient }) {
    const mode = args.external === true ? EXTERNAL : INTERNAL;

    if (args["print-schema"] === true) {
      writeJson(getQuerySchemaBundle(mode.mode));
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

    const skipValidation = explicitSkip || isLegacyNativeQuery(body);

    if (!skipValidation) {
      const outcome = mode.validate(body);
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
    const queryResult = await client.requestParsed(CardQueryResult, mode.endpoint, {
      method: "POST",
      body,
    });
    renderItem(queryResult, cardQueryView, ctx);
  },
});
