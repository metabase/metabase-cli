import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Client } from "@metabase/cli/client";
import { CardQueryResult, Parameter } from "@metabase/cli/domain";
import { type Static, Type } from "typebox";
import { z } from "zod";
import { clampRowLimit, ROW_LIMIT_DEFAULT, ROW_LIMIT_MAX, toRows } from "./dataset";
import type { MetabaseToolDeps } from "./deps";
import type { DatasetColumn } from "./payload";
import { resolveResponseFormat, responseFormatParam } from "./response-format";
import { TeachingError } from "./teaching-error";
import { datasetResult, guardTool, jsonResult, type TextToolResult } from "./tool-result";

const EXPORT_FORMATS = ["csv", "xlsx", "json"] as const;
type ExportFormat = (typeof EXPORT_FORMATS)[number];

const NEWLINE_BYTE = 0x0a;

const CardWithParameters = z
  .object({ id: z.number().int(), parameters: z.array(Parameter).nullish() })
  .loose();

const QueryColConcise = z
  .object({
    name: z.string(),
    display_name: z.string().optional(),
    base_type: z.string().optional(),
    semantic_type: z.string().nullable().optional(),
  })
  .strip();

const parameters = Type.Object({
  id: Type.Integer({ description: "The saved question (card) id to run." }),
  parameters: Type.Optional(
    Type.Array(
      Type.Object({
        id: Type.Optional(Type.String({ description: "The parameter's id." })),
        slug: Type.Optional(
          Type.String({
            description: "The parameter's slug (resolved to its id against the card).",
          }),
        ),
        value: Type.Unsafe<unknown>({ description: "The value to set." }),
      }),
      { description: "Parameter values. Identify each by `id` or `slug`." },
    ),
  ),
  row_limit: Type.Optional(
    Type.Integer({
      description: `Max rows in the JSON result (default ${ROW_LIMIT_DEFAULT}, max ${ROW_LIMIT_MAX}). Ignored for exports.`,
    }),
  ),
  export: Type.Optional(
    Type.Unsafe<ExportFormat>({
      type: "string",
      enum: [...EXPORT_FORMATS],
      description:
        "Write the full result to a file in the working directory (csv/xlsx/json) and return its path instead of inline rows.",
    }),
  ),
  response_format: responseFormatParam,
});

export function runSavedQuestionTool(deps: MetabaseToolDeps): ToolDefinition {
  return defineTool({
    name: "run_saved_question",
    label: "Run saved question",
    description:
      'Run a saved question by id, optionally with parameter values (identify each by `id` or `slug`). Returns rows inline, or set `export` to write the full result to a csv/xlsx/json file in the working directory and get its path back.\n\nExamples: `{id: 42}` · `{id: 42, parameters: [{slug: "category", value: "Gizmo"}]}` · `{id: 42, export: "csv"}`',
    parameters,
    execute: (_id, params) => runSavedQuestion(deps, params),
  });
}

type RunSavedQuestionToolParams = Static<typeof parameters>;

export function runSavedQuestion(
  deps: MetabaseToolDeps,
  params: RunSavedQuestionToolParams,
): Promise<TextToolResult> {
  return guardTool(async () => {
    const resolvedParams = await resolveParameters(deps.client, params.id, params.parameters ?? []);
    if (params.export !== undefined) {
      const result = await exportToFile(
        deps.client,
        params.id,
        resolvedParams,
        params.export,
        deps.cwd,
      );
      return jsonResult(`exported ${result.format} to ${result.path}`, result);
    }
    const format = resolveResponseFormat(params.response_format);
    return runInline(
      deps.client,
      params.id,
      resolvedParams,
      clampRowLimit(params.row_limit),
      format,
    );
  });
}

interface InputParameter {
  id?: string;
  slug?: string;
  value: unknown;
}

interface ResolvedParameter {
  id: string;
  type: string;
  target?: unknown;
  value: unknown;
}

async function resolveParameters(
  client: Client,
  cardId: number,
  inputs: InputParameter[],
): Promise<ResolvedParameter[]> {
  if (inputs.length === 0) {
    return [];
  }
  const card = await client.requestParsed(CardWithParameters, `/api/card/${cardId}`);
  const declared = card.parameters ?? [];
  return inputs.map((input) => {
    const match = declared.find(
      (param) => param.id === input.id || (input.slug !== undefined && param.slug === input.slug),
    );
    if (match === undefined) {
      const available = declared.map((param) => param.slug ?? param.id).join(", ") || "(none)";
      const wanted = input.id ?? input.slug ?? "(unnamed)";
      throw new TeachingError(
        `Card ${cardId} has no parameter "${wanted}". Available: ${available}.`,
      );
    }
    const resolved: ResolvedParameter = { id: match.id, type: match.type, value: input.value };
    if (match.target !== undefined) {
      resolved.target = match.target;
    }
    return resolved;
  });
}

async function runInline(
  client: Client,
  cardId: number,
  resolvedParams: ResolvedParameter[],
  rowLimit: number,
  format: string,
): Promise<TextToolResult> {
  const result = await client.requestParsed(CardQueryResult, `/api/card/${cardId}/query`, {
    method: "POST",
    body: { parameters: resolvedParams },
  });
  if (result.status !== "completed" || result.data === undefined) {
    const detail = result.error ?? `query returned status "${result.status}"`;
    throw new TeachingError(`Question ${cardId} failed: ${detail}`);
  }
  const rows = toRows(result.data.rows).slice(0, rowLimit);
  const continuation =
    result.data.rows.length > rowLimit
      ? `Showing ${rowLimit} of ${result.data.rows.length} rows; raise row_limit or use export.`
      : undefined;

  if (format === "detailed") {
    return jsonResult(`question ${cardId} — ${rows.length} rows`, {
      id: cardId,
      status: result.status,
      returned: rows.length,
      total_rows: result.row_count,
      cols: result.data.cols,
      rows,
      continuation,
    });
  }

  const columns: DatasetColumn[] = result.data.cols.map((col) => QueryColConcise.parse(col));
  return datasetResult({ columns, rows, returned: rows.length, offset: 0, continuation });
}

interface ExportResult {
  path: string;
  format: ExportFormat;
  bytes: number;
  row_count?: number;
}

async function exportToFile(
  client: Client,
  cardId: number,
  resolvedParams: ResolvedParameter[],
  format: ExportFormat,
  cwd: string,
): Promise<ExportResult> {
  const body = new URLSearchParams({ parameters: JSON.stringify(resolvedParams) });
  const stream = await client.requestStream(`/api/card/${cardId}/query/${format}`, {
    method: "POST",
    body,
  });
  const path = join(cwd, `card-${cardId}.${format}`);
  const { bytes, newlines } = await writeStreamToFile(stream, path);
  const result: ExportResult = { path, format, bytes };
  if (format === "csv" && newlines > 0) {
    result.row_count = newlines - 1;
  }
  return result;
}

interface WriteOutcome {
  bytes: number;
  newlines: number;
}

async function writeStreamToFile(
  stream: ReadableStream<Uint8Array>,
  path: string,
): Promise<WriteOutcome> {
  const sink = createWriteStream(path);
  const reader = stream.getReader();
  let bytes = 0;
  let newlines = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      bytes += value.byteLength;
      for (const byte of value) {
        if (byte === NEWLINE_BYTE) {
          newlines += 1;
        }
      }
      sink.write(value);
    }
  } finally {
    reader.releaseLock();
  }
  await new Promise<void>((resolve, reject) => {
    sink.on("finish", resolve);
    sink.on("error", reject);
    sink.end();
  });
  return { bytes, newlines };
}
