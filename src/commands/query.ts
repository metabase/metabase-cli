import { z } from "zod";

import { ConfigError } from "../core/errors";
import {
  getQuerySchemaBundle,
  validateExternalQuery,
  validateInternalQuery,
} from "../core/schema/validate";
import { CardQueryResult, cardQueryView } from "../domain/card";
import { renderItem, writeJson } from "../output/render";
import { readBody } from "../runtime/body";

import { bodyInputFlags } from "./body-flags";
import { connectionFlags, outputFlags, profileFlag } from "./flags";
import { defineMetabaseCommand } from "./runtime";

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
      "Run an MBQL 5 query (validates against the bundled schema first); --print-schema emits the schema for agent discovery, --dry-run validates without sending. Default is internal MBQL (numeric IDs); pass --external for the representations / string-FK form.",
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
  },
  outputSchema: CardQueryResult,
  examples: [
    "metabase query --print-schema",
    "metabase query --print-schema --external",
    "cat q.json | metabase query --dry-run",
    "metabase query --file q.json",
    "metabase query --file q.json --external",
  ],
  async run({ args, ctx, getClient }) {
    const mode = args.external === true ? EXTERNAL : INTERNAL;

    if (args["print-schema"] === true) {
      writeJson(getQuerySchemaBundle(mode.mode));
      return;
    }

    const dryRun = args["dry-run"] === true;
    const body = await readBody({ flag: args.body, file: args.file }, QueryBody);
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

    const client = await getClient();
    const queryResult = await client.requestParsed(CardQueryResult, mode.endpoint, {
      method: "POST",
      body,
    });
    renderItem(queryResult, cardQueryView, ctx);
  },
});
