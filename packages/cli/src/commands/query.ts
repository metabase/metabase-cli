import { z } from "zod";

import { CardQueryResult } from "@metabase/client/domain/card";
import type { CompiledQuery } from "@metabase/client/domain/dataset";
import { DatasetQuery } from "@metabase/client/domain/query";
import { ConfigError } from "@metabase/client/errors";
import { chainRequestFailure, HttpError } from "@metabase/client/http/errors";

import {
  assertNotLegacyEnvelopeWrappingMbql5,
  getQuerySchemaBundle,
  isMbql5Query,
  validateQuery,
  ValidationOutcome,
} from "../core/schema/validate";
import { formatQueryResult } from "../output/query-result";
import { renderSummary, writeJson } from "../output/render";
import { cardQueryView } from "../output/views/card";
import { readBody } from "../runtime/body";
import { bodyInputFlags } from "./body-flags";
import { connectionFlags, outputFlags, profileFlag } from "./flags";
import { defineMetabaseCommand } from "./runtime";
import { skipValidateFlag } from "./validate-query";

const QueryBody = z
  .unknown()
  .describe(
    'The query body: {"lib/type": "mbql/query", database, stages}; full schema: mb query --print-schema',
  );

const QueryDryRunOutcome = ValidationOutcome.extend({
  sql: z.string().nullable().describe("The compiled native query; null when it did not compile"),
});
type QueryDryRunOutcome = z.infer<typeof QueryDryRunOutcome>;

const QueryOutput = z.union([CardQueryResult, QueryDryRunOutcome]);

// A compile never touches the warehouse, and the server answers query problems (a missing table,
// an unfilled template tag) with 500 as well as 400, so both are reported against the body.
const COMPILE_REJECTION_STATUSES: ReadonlySet<number> = new Set([400, 500]);
const FORBIDDEN_STATUS = 403;

// The server's message names no location in the body, so it points at the whole query.
const WHOLE_QUERY_POINTER = "";

export default defineMetabaseCommand({
  meta: {
    name: "query",
    description: "Run an ad-hoc MBQL or native query",
  },
  details:
    'Reads a JSON query body from --body, --file, or stdin and runs it. MBQL 5 is Metabase\'s structured query format, shaped {"lib/type":"mbql/query", "database": <id>, "stages": [...]}; it is checked against a bundled JSON Schema before sending, and --print-schema prints that schema. --dry-run checks the body without running it: the local schema check, then the server compiles it to native SQL without touching the warehouse. It prints {ok, errors:[{path, message}], sql} and exits 0 when the query compiled, 2 when either check rejected it. Legacy MBQL 4 and legacy native bodies skip the local check.',
  skills: [{ skill: "mbql", purpose: "body shape, clause rules, and the dry-run loop" }],
  requires: ["dataset.native", "dataset.query"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    "dry-run": {
      type: "boolean",
      description:
        "Check the body and compile it on the server to native SQL without running it; prints {ok, errors, sql}",
    },
    "print-schema": {
      type: "boolean",
      description: "Emit the bundled MBQL 5 query JSON Schema and exit; no body required",
    },
    ...skipValidateFlag,
  },
  inputSchema: QueryBody,
  outputSchema: QueryOutput,
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

    if (!explicitSkip && isMbql5Query(body)) {
      const local = validateQuery(body);
      if (!local.ok) {
        writeJson(dryRun ? notCompiled(local) : local);
        const hint = dryRun ? "" : " — pass --dry-run to check it without running";
        throw new ConfigError(`validation failed: ${local.errors.length} error(s)${hint}`);
      }
    }

    if (dryRun) {
      const query = DatasetQuery.parse(body);
      const client = await getClient();
      const outcome = await client.dataset.native(query).then(compiledOutcome, rejectedOutcome);
      writeJson(outcome);
      if (!outcome.ok) {
        throw new ConfigError(`server validation failed: ${outcome.errors.length} error(s)`);
      }
      return;
    }

    const client = await getClient();
    const queryResult = await client.dataset.query(body);
    renderSummary(queryResult, cardQueryView, () => formatQueryResult(queryResult), ctx);
  },
});

function notCompiled(local: ValidationOutcome): QueryDryRunOutcome {
  return { ...local, sql: null };
}

function compiledOutcome(compiled: CompiledQuery): QueryDryRunOutcome {
  const sql = typeof compiled.query === "string" ? compiled.query : JSON.stringify(compiled.query);
  return { ok: true, errors: [], sql };
}

function rejectedOutcome(error: unknown): QueryDryRunOutcome {
  if (!(error instanceof HttpError)) {
    throw error;
  }
  if (error.status === FORBIDDEN_STATUS) {
    throw chainRequestFailure(
      error,
      `the compile check could not run because the server refused permission: ${error.message}`,
    );
  }
  if (!COMPILE_REJECTION_STATUSES.has(error.status)) {
    throw error;
  }
  return { ok: false, errors: [{ path: WHOLE_QUERY_POINTER, message: error.message }], sql: null };
}
