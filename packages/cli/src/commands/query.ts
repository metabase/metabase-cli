import { z } from "zod";

import { CardQueryResult } from "@metabase/client/domain/card";
import { CompiledQuery, QueryMetadata } from "@metabase/client/domain/dataset";
import { DatasetQuery } from "@metabase/client/domain/query";
import { ConfigError, type MetabaseError } from "@metabase/client/errors";
import { chainRequestFailure, HttpError } from "@metabase/client/http/errors";

import {
  assertNotLegacyEnvelopeWrappingMbql5,
  getQuerySchemaBundle,
  isMbql5Query,
  validateQuery,
  ValidationOutcome,
} from "../core/schema/validate";
import { formatQueryResult } from "../output/query-result";
import { renderItem, renderSummary, serializeJson, writeJson } from "../output/render";
import { pipeToStdout } from "../output/stream";
import { cardQueryView } from "../output/views/card";
import { compiledQueryView, queryMetadataView } from "../output/views/dataset";
import { readBody } from "../runtime/body";
import type { InputSources } from "../runtime/input";
import { bodyInputFlags } from "./body-flags";
import { assertStreamedOutput } from "./export-flags";
import { connectionFlags, outputFlags, profileFlag } from "./flags";
import { queryModeFlags, resolveQueryMode } from "./query-mode";
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

const QueryOutput = z.union([CardQueryResult, QueryDryRunOutcome, CompiledQuery, QueryMetadata]);

// A compile never touches the warehouse, and the server answers query problems (a missing table,
// an unfilled template tag) with 500 as well as 400, so both are reported against the body.
const COMPILE_REJECTION_STATUSES: ReadonlySet<number> = new Set([400, 500]);
const FORBIDDEN_STATUS = 403;

// The server's message names no location in the body, so it points at the whole query.
const WHOLE_QUERY_POINTER = "";

const VALIDATION_HINT = " — pass --dry-run to check it without running";

interface PreflightOptions {
  readonly skip: boolean;
  readonly dryRun: boolean;
}

export default defineMetabaseCommand({
  meta: {
    name: "query",
    description: "Run, compile, or inspect an ad-hoc MBQL or native query",
  },
  details:
    'Reads a JSON query body from --body, --file, or stdin and runs it. MBQL 5 is Metabase\'s structured query format, shaped {"lib/type": "mbql/query", "database": <database id>, "stages": [{"lib/type": "mbql.stage/mbql", "source-table": <table id>, "aggregation": [["count", {}]]}]} with ids from `mb database list` and `mb table list`; it is checked against a bundled JSON Schema before sending, and --print-schema prints that schema. --dry-run checks the body without running it: the local schema check, then the server compiles it to native SQL without touching the warehouse. It prints {ok, errors:[{path, message}], sql} and exits 0 when the query compiled, 2 when either check rejected it. Legacy MBQL 4 and legacy native bodies skip the local check. --compile prints the native query the server compiles the body to, --metadata the databases, tables, fields and snippets the body touches, and --export-format streams the rows as csv, json or xlsx; the three are mutually exclusive with each other, with --dry-run and with --print-schema. An export takes its column formatting and pivot layout from --visualization-settings, since an ad-hoc query has no card to read them from: --pivot-results needs their pivot_table.column_split.',
  skills: [{ skill: "mbql", purpose: "body shape, clause rules, and the dry-run loop" }],
  requires: ["dataset.exportQuery", "dataset.native", "dataset.query", "dataset.queryMetadata"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    ...queryModeFlags,
    ...skipValidateFlag,
  },
  inputSchema: QueryBody,
  outputSchema: QueryOutput,
  examples: [
    "mb query --print-schema",
    "cat q.json | mb query --dry-run",
    "mb query --file q.json",
    "mb query --file q.json --compile",
    "mb query --file q.json --metadata --json",
    "mb query --file q.json --export-format csv > rows.csv",
    "mb query --file q.json --skip-validate",
  ],
  async run({ args, ctx, getClient }) {
    const mode = resolveQueryMode(args);
    if (mode.kind === "print-schema") {
      writeJson(getQuerySchemaBundle());
      return;
    }

    const skip = args["skip-validate"] === true;
    if (mode.kind === "dry-run" && skip) {
      throw new ConfigError("--skip-validate cannot be combined with --dry-run");
    }
    if (mode.kind === "export") {
      assertStreamedOutput(ctx);
    }
    const sources = { flag: args.body, file: args.file };

    if (mode.kind === "dry-run") {
      const query = await readQuery(sources, { skip: false, dryRun: true });
      const client = await getClient();
      const outcome = await client.dataset.native(query).then(compiledOutcome, rejectedOutcome);
      writeJson(outcome);
      if (!outcome.ok) {
        throw new ConfigError(`server validation failed: ${outcome.errors.length} error(s)`);
      }
      return;
    }

    const datasetQuery = await readQuery(sources, { skip, dryRun: false });
    const client = await getClient();

    if (mode.kind === "run") {
      const queryResult = await client.dataset.query(datasetQuery);
      renderSummary(queryResult, cardQueryView, () => formatQueryResult(queryResult), ctx);
      return;
    }

    switch (mode.kind) {
      case "compile": {
        const compiled = await client.dataset
          .native(datasetQuery, { pretty: mode.pretty })
          .catch(refusedCompile);
        renderSummary(compiled, compiledQueryView, () => formatCompiledQuery(compiled), ctx);
        return;
      }
      case "metadata": {
        const metadata = await client.dataset.queryMetadata(datasetQuery);
        renderItem(metadata, queryMetadataView, ctx);
        return;
      }
      case "export": {
        const stream = await client.dataset.exportQuery(mode.format, {
          query: datasetQuery,
          ...mode.params,
        });
        await pipeToStdout(stream);
        return;
      }
    }
  },
});

function notCompiled(local: ValidationOutcome): QueryDryRunOutcome {
  return { ...local, sql: null };
}

function compiledOutcome(compiled: CompiledQuery): QueryDryRunOutcome {
  return { ok: true, errors: [], sql: formatCompiledQuery(compiled) };
}

function rejectedOutcome(error: unknown): QueryDryRunOutcome {
  if (!(error instanceof HttpError)) {
    throw error;
  }
  if (error.status === FORBIDDEN_STATUS) {
    throw compilePermissionFailure(error);
  }
  if (!COMPILE_REJECTION_STATUSES.has(error.status)) {
    throw error;
  }
  return { ok: false, errors: [{ path: WHOLE_QUERY_POINTER, message: error.message }], sql: null };
}

function refusedCompile(error: unknown): never {
  if (error instanceof HttpError && error.status === FORBIDDEN_STATUS) {
    throw compilePermissionFailure(error);
  }
  throw error;
}

// A permission failure names only the query, so the refusal says which grants a compile checks.
function compilePermissionFailure(error: HttpError): MetabaseError {
  return chainRequestFailure(
    error,
    `the server refused to compile the query; compiling needs native query permission on its database and access to every table and card it reads: ${error.message}`,
  );
}

// Held to the query shape after the pre-flight rather than by `readBody`, so a body that is no query
// is a usage error in every mode, as the pre-flight's own refusals are.
async function readQuery(sources: InputSources, options: PreflightOptions): Promise<DatasetQuery> {
  const body = await readBody(sources, QueryBody);
  preflightQuery(body, options);
  return DatasetQuery.parse(body);
}

function preflightQuery(body: unknown, options: PreflightOptions): void {
  if (options.skip) {
    return;
  }
  assertNotLegacyEnvelopeWrappingMbql5(body, { contextLabel: "query", bodyNoun: "the body" });
  if (!isMbql5Query(body)) {
    return;
  }
  const outcome = validateQuery(body);
  if (outcome.ok) {
    return;
  }
  writeJson(options.dryRun ? notCompiled(outcome) : outcome);
  const hint = options.dryRun ? "" : VALIDATION_HINT;
  throw new ConfigError(`validation failed: ${outcome.errors.length} error(s)${hint}`);
}

// The bare query composes in a shell (`SQL=$(mb query --compile --format text)`); a document
// driver's stage list has no text form, so it prints as JSON.
function formatCompiledQuery(compiled: CompiledQuery): string {
  return typeof compiled.query === "string" ? compiled.query : serializeJson(compiled.query, false);
}
