import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Client } from "@metabase/cli/client";
import { isNotFoundError } from "@metabase/cli/errors";
import { type Static, Type } from "typebox";
import type { MetabaseToolDeps } from "./deps";
import { resolveInputPath } from "./file-input";
import { TeachingError } from "./teaching-error";
import { guardTool, jsonResult, type TextToolResult } from "./tool-result";

const CSV_CONTENT_TYPE = "text/csv";
const CREATE_PATH = "/api/upload/csv";
const TABLE_ID_HEADER = "metabase-table-id";
const ROOT_COLLECTION = "root";

const UPDATE_PATHS = {
  append: "append-csv",
  replace: "replace-csv",
} as const;

const ACTIONS = ["create", "append", "replace"] as const;
type Action = (typeof ACTIONS)[number];

const parameters = Type.Object({
  action: Type.Unsafe<Action>({
    type: "string",
    enum: [...ACTIONS],
    description:
      "`create` a new table (and the model over it) from the file · `append` the file's rows to an existing uploaded table · `replace` that table's rows with the file's. `replace` discards every row already there.",
  }),
  file: Type.Optional(
    Type.String({
      description:
        "Path to the CSV or TSV file, relative to the working directory. The file is streamed to Metabase from disk — it never enters this conversation. Required.",
    }),
  ),
  collection_id: Type.Optional(
    Type.Union([Type.Integer(), Type.Literal(ROOT_COLLECTION)], {
      description:
        "`create` only: the collection to save the new model in. Defaults to the root collection.",
    }),
  ),
  table_id: Type.Optional(
    Type.Integer({
      description:
        "`append` / `replace`: the uploaded table to write into. Only tables Metabase itself created from an upload can be written this way — a warehouse table it merely synced cannot.",
    }),
  ),
});

export function uploadCsvTool(deps: MetabaseToolDeps): ToolDefinition {
  return defineTool({
    name: "upload_csv",
    label: "Upload CSV",
    description:
      'Load a CSV or TSV file from disk into Metabase\'s uploads database, as a table plus a model over it that questions can query immediately. The instance must have uploads configured; without it, the server refuses and names what is missing.\n\nExamples: `{action: "create", file: "sales-2024.csv", collection_id: 5}` · `{action: "append", file: "sales-q2.csv", table_id: 42}`',
    parameters,
    execute: (_id, params) => runUploadCsvTool(deps, params),
  });
}

type UploadCsvParams = Static<typeof parameters>;

interface CsvFile {
  filename: string;
  bytes: Uint8Array;
}

export function runUploadCsvTool(
  deps: MetabaseToolDeps,
  params: UploadCsvParams,
): Promise<TextToolResult> {
  return guardTool(async () => {
    const file = await readCsvFile(deps.cwd, params.file);
    if (params.action === "create") {
      return await createTable(deps.client, file, params.collection_id);
    }
    return await updateTable(deps.client, file, params.action, params.table_id);
  });
}

async function createTable(
  client: Client,
  file: CsvFile,
  collectionId: number | typeof ROOT_COLLECTION | undefined,
): Promise<TextToolResult> {
  const form = buildForm(file);
  form.append("collection_id", collectionId === undefined ? ROOT_COLLECTION : String(collectionId));
  const response = await client.requestRaw(CREATE_PATH, {
    method: "POST",
    body: form,
    expectContentType: "binary",
  });
  const modelId = readInteger(await response.text(), "response body");
  const tableId = readInteger(response.headers.get(TABLE_ID_HEADER), `${TABLE_ID_HEADER} header`);
  return jsonResult(
    `uploaded ${file.filename} — created table ${String(tableId)} and model ${String(modelId)}`,
    { model_id: modelId, table_id: tableId },
  );
}

type UpdateAction = keyof typeof UPDATE_PATHS;

async function updateTable(
  client: Client,
  file: CsvFile,
  action: UpdateAction,
  tableId: number | undefined,
): Promise<TextToolResult> {
  if (tableId === undefined) {
    throw new TeachingError(
      `\`${action}\` needs \`table_id\` — the uploaded table to write into. To make one from this file instead, call \`upload_csv\` with \`{action: "create"}\`.`,
    );
  }
  await client.requestRaw(`/api/table/${String(tableId)}/${UPDATE_PATHS[action]}`, {
    method: "POST",
    body: buildForm(file),
    expectContentType: "binary",
  });
  const verb = action === "append" ? "appended to" : "replaced the rows of";
  return jsonResult(`${verb} table ${String(tableId)} from ${file.filename}`, {
    table_id: tableId,
    action,
  });
}

async function readCsvFile(cwd: string, path: string | undefined): Promise<CsvFile> {
  if (path === undefined || path.trim() === "") {
    throw new TeachingError("`file` is required — the path to the CSV or TSV file to upload.");
  }
  const resolved = resolveInputPath(cwd, path);
  try {
    const bytes = await readFile(resolved);
    return { filename: basename(resolved), bytes };
  } catch (error) {
    if (isNotFoundError(error)) {
      throw new TeachingError(`file "${path}" does not exist (resolved to ${resolved}).`);
    }
    throw error;
  }
}

function buildForm(file: CsvFile): FormData {
  const form = new FormData();
  form.append("file", new Blob([file.bytes], { type: CSV_CONTENT_TYPE }), file.filename);
  return form;
}

// The create endpoint answers with the bare model id as text and the table id in a header, so both
// numbers are parsed rather than read off a JSON body.
function readInteger(value: string | null, source: string): number {
  const trimmed = value?.trim() ?? "";
  const parsed = Number(trimmed);
  if (trimmed === "" || !Number.isInteger(parsed)) {
    throw new TeachingError(
      `The upload succeeded but Metabase's ${source} was not an id: ${JSON.stringify(trimmed)}. The table exists — find it with \`browse_data\`.`,
    );
  }
  return parsed;
}
