import { z } from "zod";
import {
  entityKindOfModel,
  entityKindOfNoun,
  type EntityKind,
  type EntityRef,
} from "../tools/entity";
import type { CodeBody } from "./code";
import { GLYPH } from "./glyphs";
import { type Linker, PLAIN_LINKER } from "./link";
import type { StatusLine } from "./status-line";

const JSON_INDENT = 2;
const DETAIL_MAX = 72;
const ITEM_PREVIEW = 3;

export interface ToolCallView {
  line: StatusLine;
  body?: CodeBody | undefined;
}

/**
 * What the TUI reads off a tool call, as opposed to what the tool executes. It is deliberately one
 * lenient schema rather than fifteen: a header renders the handful of arguments a reader recognizes
 * — the verb, the thing, the file — and the rest of a tool's surface never reaches the screen.
 *
 * Every field is optional because arguments stream: a header is drawn from a half-parsed object
 * long before the model has closed the brace.
 */
const CallArgs = z
  .object({
    action: z.string(),
    method: z.string(),
    target: z.string(),
    type: z.union([z.string(), z.array(z.string())]),
    id: z.union([z.number().int(), z.string()]),
    items: z.array(z.object({ type: z.string(), id: z.number().int() }).loose()),
    database_id: z.number().int(),
    table_ids: z.array(z.number().int()),
    collection_id: z.number().int(),
    parent_id: z.number().int(),
    parameter_id: z.string(),
    schema: z.string(),
    // `search` names a keyword string; `execute_query` names an MBQL document.
    query: z.union([z.string(), z.record(z.string(), z.unknown())]),
    query_file: z.string(),
    sql: z.string(),
    sql_file: z.string(),
    native: z.object({ sql: z.string() }).partial().loose(),
    table_id: z.number().int(),
    definition: z.record(z.string(), z.unknown()),
    content: z.string(),
    layout_file: z.string(),
    source: z.record(z.string(), z.unknown()),
    source_file: z.string(),
    document_file: z.string(),
    tags: z.array(z.string()),
    schedule: z.string(),
    entity: z.string(),
    transform_id: z.number().int(),
    fields: z.array(z.object({ field_id: z.number().int() }).loose()),
    database_ids: z.array(z.number().int()),
    schema_ids: z.array(z.string()),
    key: z.string(),
    filter: z.string(),
    branch: z.string(),
    new_branch: z.string(),
    file: z.string(),
    force: z.boolean(),
    wait: z.boolean(),
    name: z.string(),
    new_name: z.string(),
    card_type: z.string(),
    display: z.string(),
    export: z.string(),
    mode: z.string(),
    depth: z.number().int(),
    recent: z.boolean(),
    archived: z.boolean(),
    is_deep_copy: z.boolean(),
    limit: z.number().int(),
    row_limit: z.number().int(),
    offset: z.number().int(),
  })
  .partial()
  .loose();

type CallArgs = z.infer<typeof CallArgs>;

type Presenter = (args: CallArgs, link: Linker) => ToolCallView;

/** An id on screen names an entity, and an entity has a page — `refOf` is what makes it clickable. */
function refOf(kind: string | null, id: number | string | undefined): EntityRef | null {
  if (kind === null || id === undefined) {
    return null;
  }
  const resolved = entityKindOfNoun(kind) ?? entityKindOfModel(kind);
  return resolved === null ? null : { kind: resolved, id };
}

function quote(value: string): string {
  return `"${truncate(value)}"`;
}

function truncate(value: string): string {
  if (value.length <= DETAIL_MAX) {
    return value;
  }
  return `${value.slice(0, DETAIL_MAX - 1)}${GLYPH.ellipsis}`;
}

function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

function list(values: readonly string[]): string {
  if (values.length <= ITEM_PREVIEW) {
    return values.join(", ");
  }
  const shown = values.slice(0, ITEM_PREVIEW).join(", ");
  return `${shown} +${values.length - ITEM_PREVIEW}`;
}

/** The content types are one filter, not several, so they read as one entry rather than several. */
function types(value: CallArgs["type"]): string[] {
  if (value === undefined) {
    return [];
  }
  if (typeof value === "string") {
    return [value];
  }
  return value.length === 0 ? [] : [value.join(", ")];
}

function inDatabase(args: CallArgs, link: Linker): string[] {
  const id = args.database_id;
  if (id === undefined) {
    return [];
  }
  return [link.text(`database ${id}`, { kind: "database", id })];
}

function inCollection(args: CallArgs, link: Linker): string[] {
  const id = args.collection_id ?? args.parent_id;
  if (id === undefined) {
    return [];
  }
  return [link.text(`collection ${id}`, { kind: "collection", id })];
}

function inTable(args: CallArgs, link: Linker): string[] {
  const id = args.table_id;
  if (id === undefined) {
    return [];
  }
  return [link.text(`table ${id}`, { kind: "table", id, databaseId: args.database_id })];
}

function sql(text: string): CodeBody {
  return { language: "sql", text };
}

function json(value: unknown): CodeBody {
  return { language: "json", text: JSON.stringify(value, null, JSON_INDENT) };
}

/** A write is the one call a reader wants to audit, so it shows what it is about to write. */
function withBody(view: ToolCallView, body: CodeBody | undefined): ToolCallView {
  return body === undefined ? view : { ...view, body };
}

function paging(args: CallArgs): string[] {
  const meta: string[] = [];
  if (args.offset !== undefined && args.offset > 0) {
    meta.push(`from ${args.offset}`);
  }
  const limit = args.row_limit ?? args.limit;
  if (limit !== undefined) {
    meta.push(`limit ${limit}`);
  }
  return meta;
}

/** A write's verb is the interesting half of its header, and `archived` overrides the method. */
function writeTitle(args: CallArgs, noun: string): string {
  if (args.archived === true) {
    return `Archive ${noun}`;
  }
  if (args.archived === false) {
    return `Restore ${noun}`;
  }
  if (args.method === "delete") {
    return `Delete ${noun}`;
  }
  if (args.method === "update") {
    return `Update ${noun}`;
  }
  if (args.method === "pull") {
    return `Pull ${noun}`;
  }
  return `Create ${noun}`;
}

function writeIcon(args: CallArgs): string {
  const removing = args.archived === true || args.method === "delete";
  return removing ? GLYPH.remove : GLYPH.write;
}

/** `create` names the thing; `update` has an id and may not restate the name. */
function writeSubject(args: CallArgs, noun: string, link: Linker): string {
  const ref = refOf(noun, args.id);
  if (args.name !== undefined) {
    return link.text(quote(args.name), ref);
  }
  return args.id === undefined ? "" : link.text(String(args.id), ref);
}

function writeView(
  args: CallArgs,
  noun: string,
  link: Linker,
  meta: readonly string[] = [],
): ToolCallView {
  return {
    line: {
      icon: writeIcon(args),
      title: writeTitle(args, noun),
      detail: writeSubject(args, noun, link),
      meta: [...inCollection(args, link), ...meta],
    },
  };
}

const BROWSE_DATA_TITLE: Record<string, string> = {
  list_databases: "Browse databases",
  list_schemas: "Browse schemas",
  list_tables: "Browse tables",
  list_models: "Browse models",
  get_fields: "Browse fields",
};

function browseData(args: CallArgs, link: Linker): ToolCallView {
  const action = args.action ?? "";
  const title = BROWSE_DATA_TITLE[action] ?? "Browse data";
  const detail =
    action === "get_fields" && args.table_ids !== undefined
      ? `of ${count(args.table_ids.length, "table")}`
      : (args.schema ?? "");
  return {
    line: { icon: GLYPH.browse, title, detail, meta: inDatabase(args, link) },
  };
}

function search(args: CallArgs, link: Linker): ToolCallView {
  const detail = args.query !== undefined ? "" : args.recent === true ? "recent items" : "";
  const meta = [...types(args.type), ...inCollection(args, link), ...paging(args)];
  if (args.archived === true) {
    meta.push("archived");
  }
  return {
    line: {
      icon: GLYPH.search,
      title: "Search",
      detail: typeof args.query === "string" ? quote(args.query) : detail,
      meta,
    },
  };
}

function browseCollection(args: CallArgs, link: Linker): ToolCallView {
  const meta = args.mode === "tree" ? ["tree", `depth ${args.depth ?? 1}`] : types(args.type);
  const id = args.id;
  return {
    line: {
      icon: GLYPH.browse,
      title: "Browse collection",
      detail: id === undefined ? "" : link.text(String(id), { kind: "collection", id }),
      meta: [...meta, ...paging(args)],
    },
  };
}

function getContent(args: CallArgs, link: Linker): ToolCallView {
  const items = args.items ?? [];
  return {
    line: {
      icon: GLYPH.fetch,
      title: "Get content",
      detail: list(
        items.map((item) => link.text(`${item.type} ${item.id}`, refOf(item.type, item.id))),
      ),
    },
  };
}

function getParameterValues(args: CallArgs, link: Linker): ToolCallView {
  const subject = [args.target, args.id].filter((part) => part !== undefined).join(" ");
  const ref = args.target === undefined ? null : refOf(args.target, args.id);
  return {
    line: {
      icon: GLYPH.fetch,
      title: "Parameter values",
      detail: link.text(subject, ref),
      meta: args.parameter_id === undefined ? [] : [args.parameter_id],
    },
  };
}

function executeSql(args: CallArgs, link: Linker): ToolCallView {
  const view: ToolCallView = {
    line: {
      icon: GLYPH.execute,
      title: "Execute SQL",
      detail: args.sql_file ?? "",
      meta: [...inDatabase(args, link), ...paging(args)],
    },
  };
  return withBody(view, args.sql === undefined ? undefined : sql(args.sql));
}

function executeQuery(args: CallArgs): ToolCallView {
  const view: ToolCallView = {
    line: {
      icon: GLYPH.execute,
      title: "Execute query",
      detail: args.query_file ?? "MBQL",
      meta: paging(args),
    },
  };
  const query = args.query;
  if (query === undefined || typeof query === "string") {
    return view;
  }
  return { ...view, body: json(query) };
}

function runSavedQuestion(args: CallArgs, link: Linker): ToolCallView {
  const meta = args.export === undefined ? paging(args) : [`export ${args.export}`];
  const id = args.id;
  return {
    line: {
      icon: GLYPH.execute,
      title: "Run question",
      detail: id === undefined ? "" : link.text(String(id), { kind: "question", id }),
      meta,
    },
  };
}

function questionWrite(args: CallArgs, link: Linker): ToolCallView {
  const noun = args.card_type ?? "question";
  const meta = args.display === undefined ? [] : [args.display];
  const native = args.native?.sql;
  const view = writeView(args, noun, link, meta);
  return withBody(view, native === undefined ? undefined : sql(native));
}

function definitionWrite(args: CallArgs, noun: string, link: Linker): ToolCallView {
  const view = writeView(args, noun, link, inTable(args, link));
  return withBody(view, args.definition === undefined ? undefined : json(args.definition));
}

function snippetWrite(args: CallArgs, link: Linker): ToolCallView {
  const view = writeView(args, "snippet", link);
  return withBody(view, args.content === undefined ? undefined : sql(args.content));
}

function dashboardWrite(args: CallArgs, link: Linker): ToolCallView {
  const meta = args.layout_file === undefined ? [] : [args.layout_file];
  return writeView(args, "dashboard", link, meta);
}

function duplicateContent(args: CallArgs, link: Linker): ToolCallView {
  const type = typeof args.type === "string" ? args.type : "content";
  const id = args.id;
  const plain = id === undefined ? type : `${type} ${id}`;
  const subject = link.text(plain, refOf(type, id));
  const meta = [...inCollection(args, link)];
  if (args.is_deep_copy === true) {
    meta.push("deep copy");
  }
  return {
    line: {
      icon: GLYPH.write,
      title: "Duplicate",
      detail:
        args.new_name === undefined ? subject : `${subject} ${GLYPH.fetch} ${quote(args.new_name)}`,
      meta,
    },
  };
}

function transformWrite(args: CallArgs, link: Linker): ToolCallView {
  const meta: string[] = [];
  if (args.tags !== undefined && args.tags.length > 0) {
    meta.push(`tags ${list(args.tags)}`);
  }
  if (args.source_file !== undefined) {
    meta.push(args.source_file);
  }
  const view = writeView(args, "transform", link, meta);
  const native = args.native?.sql;
  if (native !== undefined) {
    return withBody(view, sql(native));
  }
  return withBody(view, args.source === undefined ? undefined : json(args.source));
}

const TRANSFORM_RUN_TITLE: Record<string, string> = {
  run: "Run transform",
  cancel: "Cancel transform run",
  list_runs: "List transform runs",
  get_run: "Get transform run",
  dependencies: "Transform dependencies",
  list_jobs: "List transform jobs",
  job_transforms: "Job transforms",
  run_job: "Run transform job",
};

/** `id` is whatever the action operates on — a transform, a job, or a run, which has no page. */
const TRANSFORM_RUN_SUBJECT: Record<string, EntityKind> = {
  run: "transform",
  cancel: "transform",
  dependencies: "transform",
  run_job: "transform_job",
  job_transforms: "transform_job",
};

function transformRun(args: CallArgs, link: Linker): ToolCallView {
  const action = args.action ?? "";
  const icon =
    action === "cancel" ? GLYPH.remove : action.startsWith("run") ? GLYPH.execute : GLYPH.browse;
  const meta: string[] = [];
  const transformId = args.transform_id;
  if (transformId !== undefined) {
    meta.push(link.text(`transform ${transformId}`, { kind: "transform", id: transformId }));
  }
  if (args.wait === false) {
    meta.push("no wait");
  }
  const id = args.id;
  const kind = TRANSFORM_RUN_SUBJECT[action];
  const subject = id === undefined || kind === undefined ? null : { kind, id };
  return {
    line: {
      icon,
      title: TRANSFORM_RUN_TITLE[action] ?? "Transform",
      detail: id === undefined ? "" : link.text(String(id), subject),
      meta,
    },
  };
}

const METADATA_TITLE: Record<string, string> = {
  update_table: "Update table metadata",
  update_field: "Update field metadata",
  sync_schema: "Sync schema",
  rescan_values: "Rescan field values",
};

function metadataWrite(args: CallArgs, link: Linker): ToolCallView {
  const action = args.action ?? "";
  const fieldCount = args.fields?.length;
  const target = [...inTable(args, link), ...inDatabase(args, link)];
  return {
    line: {
      icon: action.startsWith("update") ? GLYPH.write : GLYPH.execute,
      title: METADATA_TITLE[action] ?? "Write metadata",
      detail: fieldCount === undefined ? target.join(" ") : count(fieldCount, "field"),
      meta: fieldCount === undefined ? [] : target,
    },
  };
}

const SETTINGS_TITLE: Record<string, string> = {
  list: "List settings",
  get: "Get setting",
  set: "Set setting",
};

function instanceSettings(args: CallArgs): ToolCallView {
  const action = args.action ?? "";
  return {
    line: {
      icon: action === "set" ? GLYPH.write : GLYPH.browse,
      title: SETTINGS_TITLE[action] ?? "Settings",
      detail: args.key ?? (args.filter === undefined ? "" : quote(args.filter)),
    },
  };
}

const GIT_SYNC_TITLE: Record<string, string> = {
  status: "Git-sync status",
  import: "Git-sync import",
  export: "Git-sync export",
  stash: "Git-sync stash",
  branches: "Git-sync branches",
  create_branch: "Create branch",
  add_collection: "Add collection to git-sync",
  remove_collection: "Remove collection from git-sync",
};

function gitSync(args: CallArgs, link: Linker): ToolCallView {
  const action = args.action ?? "";
  const meta: string[] = [];
  if (args.force === true) {
    meta.push("force");
  }
  if (args.wait === false) {
    meta.push("no wait");
  }
  const branch = args.branch ?? args.new_branch ?? args.name;
  const collection = inCollection(args, link);
  return {
    line: {
      icon: action === "remove_collection" ? GLYPH.remove : GLYPH.execute,
      title: GIT_SYNC_TITLE[action] ?? "Git sync",
      detail: branch ?? collection.join(""),
      meta,
    },
  };
}

const UPLOAD_TITLE: Record<string, string> = {
  create: "Upload CSV",
  append: "Append CSV",
  replace: "Replace CSV",
};

function uploadCsv(args: CallArgs, link: Linker): ToolCallView {
  const action = args.action ?? "";
  const target = args.table_id === undefined ? inCollection(args, link) : inTable(args, link);
  return {
    line: {
      icon: GLYPH.write,
      title: UPLOAD_TITLE[action] ?? "Upload CSV",
      detail: args.file ?? "",
      meta: target,
    },
  };
}

const LIBRARY_TITLE: Record<string, string> = {
  get: "Library",
  publish: "Publish to Library",
  unpublish: "Unpublish from Library",
};

function library(args: CallArgs, link: Linker): ToolCallView {
  const action = args.action ?? "";
  const selected = [
    ...(args.table_ids ?? []).map((id) => link.text(`table ${id}`, { kind: "table", id })),
    ...(args.database_ids ?? []).map((id) => link.text(`database ${id}`, { kind: "database", id })),
    ...(args.schema_ids ?? []),
  ];
  return {
    line: {
      icon:
        action === "unpublish" ? GLYPH.remove : action === "publish" ? GLYPH.write : GLYPH.browse,
      title: LIBRARY_TITLE[action] ?? "Library",
      detail: list(selected),
    },
  };
}

function documentWrite(args: CallArgs, link: Linker): ToolCallView {
  const meta = args.document_file === undefined ? [] : [args.document_file];
  return writeView(args, "document", link, meta);
}

function timelineWrite(args: CallArgs, link: Linker): ToolCallView {
  const noun = args.entity === "event" ? "timeline event" : "timeline";
  return writeView(args, noun, link);
}

const PRESENTERS: Record<string, Presenter> = {
  search,
  browse_data: browseData,
  browse_collection: browseCollection,
  get_content: getContent,
  get_parameter_values: getParameterValues,
  execute_sql: executeSql,
  execute_query: executeQuery,
  run_saved_question: runSavedQuestion,
  question_write: questionWrite,
  dashboard_write: dashboardWrite,
  duplicate_content: duplicateContent,
  collection_write: (args, link) => writeView(args, "collection", link),
  snippet_write: snippetWrite,
  segment_write: (args, link) => definitionWrite(args, "segment", link),
  measure_write: (args, link) => definitionWrite(args, "measure", link),
  transform_write: transformWrite,
  transform_run: transformRun,
  transform_job_write: (args, link) =>
    writeView(args, "transform job", link, args.schedule === undefined ? [] : [args.schedule]),
  metadata_write: metadataWrite,
  instance_settings: instanceSettings,
  git_sync: gitSync,
  upload_csv: uploadCsv,
  library,
  document_write: documentWrite,
  timeline_write: timelineWrite,
};

/**
 * A tool whose arguments have not finished streaming, or whose shape this file does not know, still
 * gets a header — its label, and nothing it cannot stand behind.
 */
function bareView(label: string): ToolCallView {
  return { line: { icon: GLYPH.execute, title: label } };
}

export function toolCallView(
  name: string,
  label: string,
  args: unknown,
  link: Linker = PLAIN_LINKER,
): ToolCallView {
  const present = PRESENTERS[name];
  const parsed = CallArgs.safeParse(args);
  if (present === undefined || !parsed.success) {
    return bareView(label);
  }
  return present(parsed.data, link);
}
