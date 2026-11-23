import { z } from "zod";

import { CardQueryResult } from "@metabase/client/domain/card";
import { CompiledQuery, QueryMetadata } from "@metabase/client/domain/dataset";
import { DatasetQuery } from "@metabase/client/domain/query";
import { ConfigError, type MetabaseError } from "@metabase/client/errors";
import {
  BAD_REQUEST_STATUS,
  chainRequestFailure,
  FORBIDDEN_STATUS,
  HttpError,
  INTERNAL_SERVER_ERROR_STATUS,
} from "@metabase/client/http/errors";

import {
  assertNotLegacyEnvelopeWrappingMbql5,
  isMbql5Query,
  validateQuery,
  ValidationOutcome,
} from "../core/schema/validate";
import { formatQueryResult } from "../output/query-result";
import { renderItem, renderSummary, serializeJson, writeJson } from "../output/render";
import { pipeToStdout } from "../output/stream";
import { cardQueryView } from "../output/views/card";
import { compiledQueryView, queryMetadataView } from "../output/views/dataset";
import { readJsonBody } from "../runtime/body";
import type { InputSources } from "../runtime/input";
import { bodyInputFlags } from "./body-flags";
import { assertStreamedOutput } from "./export-flags";
import { connectionFlags, outputFlags, profileFlag } from "./flags";
import { queryModeFlags, resolveQueryMode } from "./query-mode";
import { defineMetabaseCommand } from "./runtime";
import { QUERY_DOCUMENTS, skipValidateFlag } from "./validate-query";

const QueryBody = z.unknown();

const QueryDryRunOutcome = ValidationOutcome.extend({
  sql: z.string().nullable().describe("The compiled native query; null when it did not compile"),
});
type QueryDryRunOutcome = z.infer<typeof QueryDryRunOutcome>;

const QueryOutput = z.union([CardQueryResult, QueryDryRunOutcome, CompiledQuery, QueryMetadata]);

// A compile never touches the warehouse, and the server answers query problems (a missing table,
// an unfilled template tag) with 500 as well as 400, so both are reported against the body.
const COMPILE_REJECTION_STATUSES: ReadonlySet<number> = new Set([
  BAD_REQUEST_STATUS,
  INTERNAL_SERVER_ERROR_STATUS,
]);

// The server's message names no location in the body, so it points at the whole query.
const WHOLE_QUERY_POINTER = "";

const VALIDATION_HINT = " — fix them, or pass --skip-validate to send anyway";

interface PreflightOptions {
  readonly skip: boolean;
  readonly dryRun: boolean;
}

export default defineMetabaseCommand({
  meta: {
    name: "query",
    description: "Run, compile, or inspect an ad-hoc MBQL or native query",
  },
  details: [
    'Runs the JSON query body from `--body`, `--file`, or stdin. An MBQL 5 body, shaped `{"lib/type": "mbql/query", "database": <db-id>, "stages": [{"lib/type": "mbql.stage/mbql", "source-table": <table-id>}]}` with ids from `mb db list` and `mb table list`, is checked against the schema `mb schema query` prints. A failed check prints `{ ok, errors }` and exits 2 with no request made. Legacy MBQL 4 (`{ "type": "query", … }`) and native (`{ "type": "native", … }`) bodies skip the check, and the server normalizes them. An MBQL 5 query inside a legacy `{ "type": "query", "query": … }` envelope is refused before sending.',
    "`--dry-run`, `--compile`, `--metadata` and `--export-format` check, compile, inspect or export the query instead of running it, and you can use only one of them.",
    "| Mode | Prints |\n| --- | --- |\n| (none) | The query result. |\n| `--dry-run` | `{ ok, errors: [{ path, message }], sql }`. The local check runs first, so `--skip-validate` is refused; if it passes, the server compiles the query without running it. A local error's `path` is a JSON Pointer into the body. A server rejection (HTTP 400, or 500 for a reference it can't resolve) is one error with `path: \"\"`. `sql` is the compiled query, or `null`. |\n| `--compile` | `{ query, params }`, plus `collection` for a document database. `params` is `null` for a SQL driver, since the server inlines parameters. A run also caps an unaggregated query at the server's row limit, which the compiled query doesn't show. Text output is the query alone. |\n| `--metadata` | `{ databases, tables, fields, snippets }`: the source table and the tables its foreign keys point at (a card source is a virtual table with a `card__<id>` id), and the fields that template tags and snippets point at. With `--full`, most tables exceed the default `--max-bytes`. |\n| `--export-format` | The export bytes on stdout, capped at the server's download row limit. `--full`, `--fields` and `--max-bytes` are refused; `--json` and `--format` set only the shape of an error. An ad-hoc query has no saved settings, so `--pivot-results` needs `--visualization-settings` with `pivot_table.column_split`. |",
    "To compile, with `--compile` or `--dry-run`, you need native query permission on the body's database and access to every table and card the query reads. Without them, the server refuses with 403 (exit 1).",
    "| Code | When |\n| --- | --- |\n| `0` | The query ran, compiled, or its metadata was read. |\n| `2` | A flag is wrong, the body is malformed (it has neither `lib/type` nor `type`), or the local check rejected it. With `--dry-run`, also when the server compile rejected it. |\n| `1` | A server error after the local check passed: network, HTTP 4xx or 5xx, or a compile the server refused. |",
    "The `create` and `update` commands of [card](card.md), [transform](transform.md), [measure](measure.md), [segment](segment.md) and [data-action](data-action.md) run the same check on the query in their body: a card's or data action's `dataset_query`, a transform's `source.query` (when `source.type` is `\"query\"`), and a measure's or segment's `definition`. A failure exits 2 the same way, and each command takes `--skip-validate`. Legacy MBQL 4 queries and Python transform sources aren't checked.",
  ].join("\n\n"),
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
  inputDocuments: QUERY_DOCUMENTS,
  outputSchema: QueryOutput,
  examples: [
    "mb schema query",
    "cat q.json | mb query --dry-run",
    "mb query --file q.json",
    "mb query --file q.json --compile",
    "mb query --file q.json --compile --no-pretty --format text",
    "mb query --file q.json --metadata --json",
    "mb query --file q.json --export-format csv > rows.csv",
    'mb query --file pivot.json --export-format xlsx --pivot-results --visualization-settings \'{"pivot_table.column_split":{"rows":["category"],"columns":["status"],"values":["count"]}}\' > pivot.xlsx',
    "mb query --file q.json --skip-validate",
  ],
  async run({ args, ctx, getClient }) {
    const mode = resolveQueryMode(args);
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

// Held to the query shape after the pre-flight rather than as it is read, so a body that is no query
// is a usage error in every mode, as the pre-flight's own refusals are.
async function readQuery(sources: InputSources, options: PreflightOptions): Promise<DatasetQuery> {
  const body = await readJsonBody(sources, QueryBody);
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
