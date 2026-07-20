import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Client } from "@metabase/cli/client";
import {
  Card,
  Collection,
  Dashboard,
  DashboardCompact,
  DashboardCreateInput,
  DashboardDetail,
  DashboardUpdateInput,
  Table,
} from "@metabase/cli/domain";
import { HttpError, type HttpErrorKind } from "@metabase/cli/errors";
import { type Static, Type } from "typebox";
import { z } from "zod";
import {
  buildEditableLayout,
  type CardFacts,
  collectLayoutCardIds,
  collectLayoutLinkRefs,
  compileDashboardLayout,
  type CompiledDashboard,
  type DashboardState,
  type EditableLayout,
  GRID_WIDTH,
  type LayoutContext,
  type LinkEntity,
  type LinkEntityType,
  linkEntityKey,
  parseLayout,
  type TemplateTagKind,
} from "./dashboard-layout";
import type { MetabaseToolDeps } from "./deps";
import { readJsonFileInput } from "./file-input";
import { writeJsonFileOutput } from "./file-output";
import { TeachingError } from "./teaching-error";
import { readSkillsFirst, type SkillName, skillsAfterRejection } from "./skill-prereq";
import { entityResult, guardTool, jsonResult, type TextToolResult } from "./tool-result";
import { missingFieldError } from "./write-recipe";

const DASHBOARD: readonly SkillName[] = ["dashboard", "visualization"];

const DASHBOARD_METHODS = ["pull", "create", "update"] as const;
type DashboardMethod = (typeof DASHBOARD_METHODS)[number];

const LAYOUT_DESCRIPTION =
  "The full canvas as one document: `{tabs?: [{id?, name}], parameters?: [{id?, name, type, ...}], dashcards: [...]}`. " +
  "Each dashcard carries exactly one content source (`card_id`, `text`, `heading`, `link`, `iframe`) plus optional `tab_id`, `row`/`col` (omit to autoplace), `size_x`/`size_y` (omit for the display's default), `series`, `visualization_settings`, `inline_parameters`, and `parameter_mappings` (`{parameter_id, target_field | target_tag | target}`). " +
  "A dashcard with an `id` is an existing one kept; a dashcard without one is added; a dashcard the document omits is removed. New tabs may carry negative ids so dashcards can reference them via `tab_id`.";

const parameters = Type.Object({
  method: Type.Unsafe<DashboardMethod>({
    type: "string",
    enum: [...DASHBOARD_METHODS],
    description:
      "`pull` writes the dashboard's editable layout to a file; `create` makes a new dashboard; `update` writes fields and, when a layout is given, the full canvas.",
  }),
  id: Type.Optional(
    Type.Integer({ description: "Dashboard id. Required for `pull` and `update`." }),
  ),
  name: Type.Optional(Type.String({ description: "Dashboard title. Required for `create`." })),
  description: Type.Optional(Type.String()),
  collection_id: Type.Optional(
    Type.Integer({
      description:
        "Collection the dashboard lives in. Omit for the root collection; set it to move.",
    }),
  ),
  collection_position: Type.Optional(
    Type.Integer({ description: "Pins the dashboard at the top of its collection." }),
  ),
  archived: Type.Optional(
    Type.Boolean({
      description: "`update` only: `true` sends the dashboard to the trash, `false` restores it.",
    }),
  ),
  width: Type.Optional(
    Type.Unsafe<DashboardWidth>({
      type: "string",
      enum: ["fixed", "full"],
      description: "`fixed` centres the dashboard at a max width; `full` fills the viewport.",
    }),
  ),
  auto_apply_filters: Type.Optional(
    Type.Boolean({
      description: "Whether filter changes re-run the cards immediately (default) or on Apply.",
    }),
  ),
  cache_ttl: Type.Optional(Type.Integer({ description: "Cache lifetime in seconds." })),
  layout: Type.Optional(
    Type.Unsafe<Record<string, unknown>>({
      type: "object",
      additionalProperties: true,
      description: `${LAYOUT_DESCRIPTION} Pass inline for small layouts; prefer \`layout_file\` for anything pulled.`,
    }),
  ),
  layout_file: Type.Optional(
    Type.String({
      description:
        "Path to a JSON file holding the layout document. On `pull` the tool writes the file (default `dashboard-<id>.layout.json`); on `create`/`update` it reads it. Edit the pulled file with your editing tools, then update with the same path — the document never has to travel through the conversation.",
    }),
  ),
  validate_only: Type.Optional(
    Type.Boolean({
      description: "Compile the layout and return the resulting write without applying it.",
    }),
  ),
});

const DASHBOARD_WIDTHS = ["fixed", "full"] as const;
type DashboardWidth = (typeof DASHBOARD_WIDTHS)[number];

export function dashboardWriteTool(deps: MetabaseToolDeps): ToolDefinition {
  return defineTool({
    name: "dashboard_write",
    label: "Write dashboard",
    description:
      `${readSkillsFirst(DASHBOARD)}\n\n` +
      `Create, edit, or pull a dashboard. Dashboard-level fields (name, description, collection_id, collection_position, archived, width) are top-level parameters and need no layout. The canvas — cards, tabs, filters — is a single layout document, passed inline (\`layout\`) or as a file (\`layout_file\`). To edit an existing canvas: \`{method: "pull", id}\` writes the current layout to a file; edit it on disk; \`{method: "update", id, layout_file}\` validates the document and applies it as one write. The document is the complete canvas — dashcards it omits are removed, so always start an edit from a pull. Positions autoplace on the ${GRID_WIDTH}-column grid when \`row\`/\`col\` are omitted.\n\n` +
      'A filter only filters cards its dashcards map: give the parameter an id in `parameters` and reference it from a dashcard\'s `parameter_mappings`. Examples: `{method: "pull", id: 3}` · `{method: "update", id: 3, layout_file: "dashboard-3.layout.json"}` · `{method: "create", name: "Q3 Review", layout: {parameters: [{id: "created_at", name: "Created At", type: "date/all-options"}], dashcards: [{heading: "Q3"}, {card_id: 12, parameter_mappings: [{parameter_id: "created_at", target_field: 1779}]}]}}` · `{method: "update", id: 3, archived: true}`',
    parameters,
    execute: (_id, params) => runDashboardWriteTool(deps, params),
  });
}

type DashboardWriteParams = Static<typeof parameters>;

export function runDashboardWriteTool(
  deps: MetabaseToolDeps,
  params: DashboardWriteParams,
): Promise<TextToolResult> {
  return guardTool(async () => {
    if (params.method === "pull") {
      return runPull(deps, params);
    }
    return runWrite(deps, params, params.method);
  }, skillsAfterRejection(DASHBOARD));
}

const DEFAULT_LAYOUT_FILE = (id: number): string => `dashboard-${id}.layout.json`;

async function runPull(
  deps: MetabaseToolDeps,
  params: DashboardWriteParams,
): Promise<TextToolResult> {
  const id = requireId(params, "pull");
  const state = await fetchState(deps.client, id);
  const layout = buildEditableLayout(state);
  const file = await writeJsonFileOutput(
    deps.cwd,
    params.layout_file ?? DEFAULT_LAYOUT_FILE(id),
    layout,
  );
  return jsonResult(`pulled dashboard ${id} layout to ${file}`, {
    file,
    dashcards: layout.dashcards.length,
    tabs: layout.tabs?.length ?? 0,
    parameters: layout.parameters?.length ?? 0,
    note: `Edit the file, then apply it with {method: "update", id: ${id}, layout_file: "${file}"}. The document is the complete canvas — dashcards you remove from it are removed from the dashboard.`,
  });
}

async function runWrite(
  deps: MetabaseToolDeps,
  params: DashboardWriteParams,
  method: "create" | "update",
): Promise<TextToolResult> {
  if (method === "create" && params.name === undefined) {
    throw missingFieldError("create", ["name"], params);
  }
  const id = method === "update" ? requireId(params, "update") : undefined;

  const layout = await resolveLayout(deps, params);
  let compiled: CompiledDashboard | null = null;
  if (layout !== null) {
    const current = id === undefined ? null : await fetchState(deps.client, id);
    const context = await buildContext(deps.client, layout);
    compiled = compileDashboardLayout(layout, current, context);
  }

  if (params.validate_only === true) {
    if (compiled === null) {
      throw new TeachingError("validate_only checks a layout — pass `layout` or `layout_file`.");
    }
    return jsonResult("layout validated (not written)", {
      validated: true,
      written: false,
      dashcards: compiled.dashcards,
      tabs: compiled.tabs,
      parameters: compiled.parameters,
    });
  }

  const fields = dashboardFields(params);
  const dashboard = await write(deps.client, method, id, fields, compiled);
  return entityResult(
    "dashboard",
    `${method}d dashboard ${dashboard.id}`,
    conciseDashboard(dashboard),
  );
}

function requireId(params: DashboardWriteParams, method: DashboardMethod): number {
  if (params.id === undefined) {
    throw missingFieldError(method, ["id"], params);
  }
  return params.id;
}

async function resolveLayout(
  deps: MetabaseToolDeps,
  params: DashboardWriteParams,
): Promise<EditableLayout | null> {
  const hasInline = params.layout !== undefined;
  const hasFile = params.layout_file !== undefined && params.layout_file !== "";
  if (hasInline && hasFile) {
    throw new TeachingError("Provide at most one of `layout` or `layout_file`.");
  }
  if (hasFile && params.layout_file !== undefined) {
    return parseLayout(await readJsonFileInput(deps.cwd, params.layout_file, "layout_file"));
  }
  if (hasInline) {
    return parseLayout(params.layout);
  }
  return null;
}

interface DashboardFields {
  name?: string;
  description?: string;
  collection_id?: number;
  collection_position?: number;
  archived?: boolean;
  width?: DashboardWidth;
  auto_apply_filters?: boolean;
  cache_ttl?: number;
}

function dashboardFields(params: DashboardWriteParams): DashboardFields {
  const fields: DashboardFields = {};
  if (params.name !== undefined) {
    fields.name = params.name;
  }
  if (params.description !== undefined) {
    fields.description = params.description;
  }
  if (params.collection_id !== undefined) {
    fields.collection_id = params.collection_id;
  }
  if (params.collection_position !== undefined) {
    fields.collection_position = params.collection_position;
  }
  if (params.archived !== undefined) {
    fields.archived = params.archived;
  }
  if (params.width !== undefined) {
    fields.width = params.width;
  }
  if (params.auto_apply_filters !== undefined) {
    fields.auto_apply_filters = params.auto_apply_filters;
  }
  if (params.cache_ttl !== undefined) {
    fields.cache_ttl = params.cache_ttl;
  }
  return fields;
}

async function fetchState(client: Client, id: number): Promise<DashboardState> {
  const dashboard = await client.requestParsed(DashboardDetail, `/api/dashboard/${id}`);
  return {
    dashcards: dashboard.dashcards,
    tabs: dashboard.tabs,
    parameters: dashboard.parameters,
  };
}

async function write(
  client: Client,
  method: "create" | "update",
  id: number | undefined,
  fields: DashboardFields,
  compiled: CompiledDashboard | null,
): Promise<Dashboard> {
  const layout =
    compiled === null
      ? {}
      : {
          dashcards: compiled.dashcards,
          tabs: compiled.tabs,
          parameters: compiled.parameters,
        };

  if (method === "update") {
    const body = DashboardUpdateInput.parse({ ...fields, ...layout });
    return client.requestParsed(DashboardDetail, `/api/dashboard/${String(id)}`, {
      method: "PUT",
      body,
    });
  }

  const created = await client.requestParsed(Dashboard, "/api/dashboard", {
    method: "POST",
    body: DashboardCreateInput.parse(fields),
  });
  if (compiled === null) {
    return created;
  }
  return client.requestParsed(DashboardDetail, `/api/dashboard/${created.id}`, {
    method: "PUT",
    body: DashboardUpdateInput.parse(layout),
  });
}

function conciseDashboard(dashboard: Dashboard): unknown {
  return { ...DashboardCompact.parse(dashboard), parameters: dashboard.parameters ?? [] };
}

async function buildContext(client: Client, layout: EditableLayout): Promise<LayoutContext> {
  const cards = new Map<number, CardFacts>();
  for (const cardId of collectLayoutCardIds(layout)) {
    const facts = await cardFacts(client, cardId);
    if (facts !== null) {
      cards.set(cardId, facts);
    }
  }

  const linkEntities = new Map<string, LinkEntity>();
  for (const ref of collectLayoutLinkRefs(layout)) {
    const entity = await linkEntity(client, ref.type, ref.id);
    if (entity !== null) {
      linkEntities.set(linkEntityKey(ref.type, ref.id), entity);
    }
  }

  return { cards, linkEntities };
}

// A card the caller can't read is not an HTTP failure of this tool — it is an invalid layout
// entry, and the compiler reports it with the dashcard index that named it.
async function cardFacts(client: Client, cardId: number): Promise<CardFacts | null> {
  const card = await readOrNull(() => client.requestParsed(Card, `/api/card/${cardId}`));
  if (card === null || card.archived) {
    return null;
  }
  return { display: card.display, templateTags: templateTagKinds(card.dataset_query) };
}

const UNREADABLE_KINDS: ReadonlySet<HttpErrorKind> = new Set(["resource-missing", "auth"]);

async function readOrNull<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof HttpError && UNREADABLE_KINDS.has(error.kind)) {
      return null;
    }
    throw error;
  }
}

const WIREABLE_TAG_KINDS: ReadonlyMap<string, TemplateTagKind> = new Map([
  ["dimension", "dimension"],
  ["text", "variable"],
  ["number", "variable"],
  ["date", "variable"],
  ["boolean", "variable"],
]);

const TemplateTagMap = z.record(z.string(), z.object({ type: z.string() }).loose());
const TaggedQuery = z
  .object({
    stages: z.array(z.object({ "template-tags": TemplateTagMap.optional() }).loose()).optional(),
    native: z.object({ "template-tags": TemplateTagMap.optional() }).loose().optional(),
  })
  .loose();

export function templateTagKinds(datasetQuery: unknown): ReadonlyMap<string, TemplateTagKind> {
  const kinds = new Map<string, TemplateTagKind>();
  const parsed = TaggedQuery.safeParse(datasetQuery);
  if (!parsed.success) {
    return kinds;
  }
  const stageTags = parsed.data.stages?.flatMap((stage) =>
    Object.entries(stage["template-tags"] ?? {}),
  );
  const nativeTags = Object.entries(parsed.data.native?.["template-tags"] ?? {});
  for (const [name, tag] of [...(stageTags ?? []), ...nativeTags]) {
    const kind = WIREABLE_TAG_KINDS.get(tag.type);
    if (kind !== undefined) {
      kinds.set(name, kind);
    }
  }
  return kinds;
}

const LINK_MODELS: ReadonlyMap<LinkEntityType, string> = new Map([
  ["question", "card"],
  ["model", "dataset"],
  ["metric", "metric"],
  ["dashboard", "dashboard"],
  ["collection", "collection"],
  ["table", "table"],
]);

async function linkEntity(
  client: Client,
  type: LinkEntityType,
  id: number,
): Promise<LinkEntity | null> {
  const model = LINK_MODELS.get(type);
  if (model === undefined) {
    return null;
  }
  const name = await entityName(client, type, id);
  return name === null ? null : { id, model, name };
}

async function entityName(
  client: Client,
  type: LinkEntityType,
  id: number,
): Promise<string | null> {
  if (type === "dashboard") {
    const dashboard = await readOrNull(() =>
      client.requestParsed(Dashboard, `/api/dashboard/${id}`),
    );
    return dashboard === null ? null : dashboard.name;
  }
  if (type === "collection") {
    const collection = await readOrNull(() =>
      client.requestParsed(Collection, `/api/collection/${id}`),
    );
    return collection === null ? null : collection.name;
  }
  if (type === "table") {
    const table = await readOrNull(() => client.requestParsed(Table, `/api/table/${id}`));
    if (table === null) {
      return null;
    }
    return table.display_name ?? table.name;
  }
  const card = await readOrNull(() => client.requestParsed(Card, `/api/card/${id}`));
  return card === null ? null : card.name;
}
