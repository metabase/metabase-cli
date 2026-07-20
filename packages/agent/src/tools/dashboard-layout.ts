import {
  type Dashcard,
  type DashboardTab,
  Parameter,
  ParameterMapping,
  ParameterTarget,
  ParameterType,
  TemporalUnit,
  ValuesQueryType,
  ValuesSourceConfig,
  ValuesSourceType,
} from "@metabase/cli/domain";
import { z } from "zod";
import { TeachingError } from "./teaching-error";

export const GRID_WIDTH = 24;
const MAX_AUTOPLACE_ROWS = 1000;
const FALLBACK_CARD_SIZE: CardSize = { size_x: 4, size_y: 4 };

interface CardSize {
  size_x: number;
  size_y: number;
}

// Ported from the server's `metabase.dashboards.constants/card-size-defaults` (`:default` entries),
// which the frontend grid mirrors. Keep in sync when the product adds a display type.
const CARD_SIZE_DEFAULTS: ReadonlyMap<string, CardSize> = new Map([
  ["table", { size_x: 12, size_y: 9 }],
  ["list", { size_x: 12, size_y: 9 }],
  ["gauge", { size_x: 12, size_y: 6 }],
  ["bar", { size_x: 12, size_y: 6 }],
  ["pie", { size_x: 12, size_y: 8 }],
  ["scatter", { size_x: 12, size_y: 6 }],
  ["boxplot", { size_x: 12, size_y: 6 }],
  ["waterfall", { size_x: 14, size_y: 6 }],
  ["combo", { size_x: 12, size_y: 6 }],
  ["sankey", { size_x: 16, size_y: 10 }],
  ["scalar", { size_x: 6, size_y: 3 }],
  ["line", { size_x: 12, size_y: 6 }],
  ["link", { size_x: 8, size_y: 1 }],
  ["iframe", { size_x: 12, size_y: 8 }],
  ["action", { size_x: 4, size_y: 1 }],
  ["area", { size_x: 12, size_y: 6 }],
  ["pivot", { size_x: 12, size_y: 9 }],
  ["funnel", { size_x: 12, size_y: 6 }],
  ["progress", { size_x: 12, size_y: 6 }],
  ["smartscalar", { size_x: 6, size_y: 3 }],
  ["map", { size_x: 12, size_y: 6 }],
  ["object", { size_x: 12, size_y: 9 }],
  ["row", { size_x: 12, size_y: 6 }],
  ["heading", { size_x: GRID_WIDTH, size_y: 1 }],
  ["text", { size_x: 12, size_y: 3 }],
]);

export const LINK_ENTITY_TYPES = [
  "question",
  "model",
  "metric",
  "dashboard",
  "collection",
  "table",
] as const;
export type LinkEntityType = (typeof LINK_ENTITY_TYPES)[number];

const LayoutLink = z
  .object({
    url: z.string().optional(),
    entity: z
      .object({ type: z.enum(LINK_ENTITY_TYPES), id: z.number().int() })
      .strict()
      .optional(),
  })
  .strict();
type LayoutLink = z.infer<typeof LayoutLink>;

const LayoutMapping = z
  .object({
    parameter_id: z.string(),
    target_field: z.number().int().optional(),
    target_tag: z.string().optional(),
    target: z.unknown().optional(),
  })
  .strict();
type LayoutMapping = z.infer<typeof LayoutMapping>;

const LayoutDashcard = z
  .object({
    id: z.number().int().optional(),
    card_id: z.number().int().optional(),
    action_id: z.number().int().optional(),
    text: z.string().optional(),
    heading: z.string().optional(),
    link: LayoutLink.optional(),
    iframe: z.string().optional(),
    tab_id: z.number().int().optional(),
    row: z.number().int().optional(),
    col: z.number().int().optional(),
    size_x: z.number().int().optional(),
    size_y: z.number().int().optional(),
    series: z.array(z.number().int()).optional(),
    inline_parameters: z.array(z.string()).optional(),
    visualization_settings: z.record(z.string(), z.unknown()).optional(),
    parameter_mappings: z.array(LayoutMapping).optional(),
  })
  .strict();
type LayoutDashcard = z.infer<typeof LayoutDashcard>;

const LayoutTab = z.object({ id: z.number().int().optional(), name: z.string().min(1) }).strict();
type LayoutTab = z.infer<typeof LayoutTab>;

const LayoutParameter = z
  .object({
    id: z.string().optional(),
    name: z.string(),
    type: ParameterType,
    slug: z.string().optional(),
    sectionId: z.string().optional(),
    default: z.unknown().optional(),
    required: z.boolean().optional(),
    isMultiSelect: z.boolean().optional(),
    filteringParameters: z.array(z.string()).nullable().optional(),
    temporal_units: z.array(TemporalUnit).nullable().optional(),
    values_query_type: ValuesQueryType.nullable().optional(),
    values_source_type: ValuesSourceType.nullable().optional(),
    values_source_config: ValuesSourceConfig.nullable().optional(),
  })
  .strict();
type LayoutParameter = z.infer<typeof LayoutParameter>;

export const EditableLayout = z
  .object({
    tabs: z.array(LayoutTab).optional(),
    parameters: z.array(LayoutParameter).optional(),
    dashcards: z.array(LayoutDashcard),
  })
  .strict();
export type EditableLayout = z.infer<typeof EditableLayout>;

export function parseLayout(value: unknown): EditableLayout {
  const parsed = EditableLayout.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issuePath(issue.path)}: ${issue.message}`)
      .join("; ");
    throw new TeachingError(`The layout does not parse: ${issues}`);
  }
  return parsed.data;
}

function issuePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) {
    return "layout";
  }
  return (
    "layout" +
    path.map((step) => (typeof step === "number" ? `[${step}]` : `.${String(step)}`)).join("")
  );
}

const VisualizationSettings = z.record(z.string(), z.unknown());
type VisualizationSettings = z.infer<typeof VisualizationSettings>;

export interface SeriesRef {
  id: number;
}

export interface DashcardWrite {
  id: number;
  card_id: number | null;
  action_id: number | null;
  dashboard_tab_id: number | null;
  row: number;
  col: number;
  size_x: number;
  size_y: number;
  visualization_settings: VisualizationSettings;
  parameter_mappings: ParameterMapping[];
  inline_parameters: string[];
  series: SeriesRef[];
}

export interface TabWrite {
  id: number;
  name: string;
}

export interface DashboardState {
  dashcards: readonly Dashcard[];
  tabs: readonly DashboardTab[];
  parameters: readonly Parameter[];
}

export interface CompiledDashboard {
  dashcards: DashcardWrite[];
  tabs: TabWrite[];
  parameters: Parameter[];
}

export interface LinkEntity {
  id: number;
  model: string;
  name: string;
}

export type TemplateTagKind = "dimension" | "variable";

export interface CardFacts {
  display: string;
  templateTags: ReadonlyMap<string, TemplateTagKind>;
}

export interface LayoutContext {
  cards: ReadonlyMap<number, CardFacts>;
  linkEntities: ReadonlyMap<string, LinkEntity>;
}

export function linkEntityKey(type: LinkEntityType, id: number): string {
  return `${type}:${id}`;
}

export function collectLayoutCardIds(layout: EditableLayout): Set<number> {
  const ids = new Set<number>();
  for (const dashcard of layout.dashcards) {
    if (dashcard.card_id !== undefined) {
      ids.add(dashcard.card_id);
    }
    for (const id of dashcard.series ?? []) {
      ids.add(id);
    }
  }
  return ids;
}

export interface LinkEntityRef {
  type: LinkEntityType;
  id: number;
}

export function collectLayoutLinkRefs(layout: EditableLayout): LinkEntityRef[] {
  const refs = new Map<string, LinkEntityRef>();
  for (const dashcard of layout.dashcards) {
    const entity = dashcard.link?.entity;
    if (entity !== undefined) {
      refs.set(linkEntityKey(entity.type, entity.id), entity);
    }
  }
  return [...refs.values()];
}

const CONTENT_SOURCES = ["card_id", "text", "heading", "link", "iframe", "action_id"] as const;
type ContentSource = (typeof CONTENT_SOURCES)[number];

// `current` is the dashboard being updated (null on create): positive ids in the layout must name
// a dashcard or tab that actually exists, so a typo dies here instead of as an opaque REST 400.
export function compileDashboardLayout(
  layout: EditableLayout,
  current: DashboardState | null,
  context: LayoutContext,
): CompiledDashboard {
  const tabs = compileTabs(layout.tabs ?? [], current);
  const parameters = compileParameters(layout.parameters ?? []);
  const dashcards = compileDashcards(layout, tabs, parameters, current, context);
  return { dashcards, tabs: tabs.writes, parameters };
}

interface CompiledTabs {
  writes: TabWrite[];
  ids: Set<number>;
  firstId: number | null;
}

function compileTabs(tabs: readonly LayoutTab[], current: DashboardState | null): CompiledTabs {
  const writes: TabWrite[] = [];
  const ids = new Set<number>();
  const currentIds = new Set((current?.tabs ?? []).map((tab) => tab.id));
  let nextId = Math.min(0, ...tabs.map((tab) => tab.id ?? 0)) - 1;

  for (const [index, tab] of tabs.entries()) {
    const id = tab.id ?? nextId--;
    if (ids.has(id)) {
      throw new TeachingError(`tabs[${index}]: tab id ${id} appears twice in the layout.`);
    }
    if (id > 0 && current === null) {
      throw new TeachingError(
        `tabs[${index}]: a create starts from an empty dashboard — drop \`id\` ${id} (new tabs need no id, or a negative one to reference from dashcards).`,
      );
    }
    if (id > 0 && !currentIds.has(id)) {
      throw new TeachingError(
        `tabs[${index}]: tab ${id} is not on this dashboard — pull the current layout to see its tabs, or drop \`id\` to add a new one.`,
      );
    }
    ids.add(id);
    writes.push({ id, name: tab.name });
  }

  const first = writes[0];
  return { writes, ids, firstId: first === undefined ? null : first.id };
}

function compileParameters(parameters: readonly LayoutParameter[]): Parameter[] {
  const compiled: Parameter[] = [];
  const ids = new Set<string>();
  for (const [index, parameter] of parameters.entries()) {
    const id = parameter.id ?? mintParameterId(parameter.name, ids);
    if (ids.has(id)) {
      throw new TeachingError(
        `parameters[${index}]: parameter id "${id}" appears twice in the layout.`,
      );
    }
    ids.add(id);
    compiled.push({
      ...parameter,
      id,
      slug: parameter.slug ?? slugify(parameter.name),
      sectionId: parameter.sectionId ?? sectionIdFor(parameter.type),
    });
  }
  for (const [index, parameter] of compiled.entries()) {
    for (const linked of parameter.filteringParameters ?? []) {
      if (!ids.has(linked)) {
        throw new TeachingError(
          `parameters[${index}]: filteringParameters names "${linked}", which is not a parameter in this layout — ${knownIds(ids)}.`,
        );
      }
    }
  }
  return compiled;
}

function compileDashcards(
  layout: EditableLayout,
  tabs: CompiledTabs,
  parameters: readonly Parameter[],
  current: DashboardState | null,
  context: LayoutContext,
): DashcardWrite[] {
  const parameterIds = new Set(parameters.map((parameter) => parameter.id));
  const currentById = new Map(
    (current?.dashcards ?? []).map((dashcard) => [dashcard.id, dashcard]),
  );
  const usedIds = new Set<number>();
  let nextId = Math.min(0, ...layout.dashcards.map((dashcard) => dashcard.id ?? 0)) - 1;

  const writes: DashcardWrite[] = [];
  for (const [index, dashcard] of layout.dashcards.entries()) {
    const id = dashcard.id ?? nextId--;
    if (usedIds.has(id)) {
      throw new TeachingError(
        `dashcards[${index}]: dashcard id ${id} appears twice in the layout.`,
      );
    }
    if (id > 0 && current === null) {
      throw new TeachingError(
        `dashcards[${index}]: a create starts from an empty dashboard — drop \`id\` ${id}.`,
      );
    }
    if (id > 0 && !currentById.has(id)) {
      throw new TeachingError(
        `dashcards[${index}]: dashcard ${id} is not on this dashboard — pull the current layout to see its dashcards, or drop \`id\` to add a new card.`,
      );
    }
    usedIds.add(id);
    writes.push(compileDashcard(index, dashcard, id, tabs, parameterIds, context));
  }

  const inlineOwners = new Map<string, number>();
  for (const [index, write] of writes.entries()) {
    for (const parameterId of write.inline_parameters) {
      const owner = inlineOwners.get(parameterId);
      if (owner !== undefined) {
        throw new TeachingError(
          `dashcards[${index}]: parameter "${parameterId}" is already inline on dashcards[${owner}] — a parameter lives on one card or in the header, not both.`,
        );
      }
      inlineOwners.set(parameterId, index);
    }
  }

  autoplaceDashcards(layout.dashcards, writes);
  return writes;
}

function compileDashcard(
  index: number,
  dashcard: LayoutDashcard,
  id: number,
  tabs: CompiledTabs,
  parameterIds: ReadonlySet<string>,
  context: LayoutContext,
): DashcardWrite {
  const source = contentSourceOf(index, dashcard);
  const settings = dashcard.visualization_settings ?? {};
  const display = displayOf(index, dashcard, source, context);

  if (dashcard.series !== undefined && source !== "card_id") {
    throw new TeachingError(
      `dashcards[${index}]: \`series\` overlays saved questions on a question card — this dashcard has no \`card_id\`.`,
    );
  }
  for (const seriesId of dashcard.series ?? []) {
    if (!context.cards.has(seriesId)) {
      throw new TeachingError(
        `dashcards[${index}]: series card ${seriesId} does not exist or is not readable.`,
      );
    }
  }
  for (const parameterId of dashcard.inline_parameters ?? []) {
    if (!parameterIds.has(parameterId)) {
      throw new TeachingError(
        `dashcards[${index}]: inline_parameters names "${parameterId}", which is not a parameter in this layout — ${knownIds(parameterIds)}.`,
      );
    }
  }

  const size = sizeOf(index, dashcard, display);
  const tabId = tabIdOf(index, dashcard, tabs);
  const cardId = source === "card_id" && dashcard.card_id !== undefined ? dashcard.card_id : null;

  const write: DashcardWrite = {
    id,
    card_id: cardId,
    action_id:
      source === "action_id" && dashcard.action_id !== undefined ? dashcard.action_id : null,
    dashboard_tab_id: tabId,
    row: dashcard.row ?? -1,
    col: dashcard.col ?? -1,
    size_x: size.size_x,
    size_y: size.size_y,
    visualization_settings: virtualSettings(index, dashcard, source, settings, context),
    parameter_mappings: (dashcard.parameter_mappings ?? []).map((mapping) =>
      resolveMapping(index, mapping, cardId, display, parameterIds, context),
    ),
    inline_parameters: dashcard.inline_parameters ?? [],
    series: (dashcard.series ?? []).map((seriesId) => ({ id: seriesId })),
  };

  if (dashcard.row !== undefined || dashcard.col !== undefined) {
    if (dashcard.row === undefined || dashcard.col === undefined) {
      throw new TeachingError(
        `dashcards[${index}]: \`row\` and \`col\` come together — provide both for an explicit position, or neither to autoplace.`,
      );
    }
    if (dashcard.row < 0 || dashcard.col < 0 || dashcard.col + size.size_x > GRID_WIDTH) {
      throw new TeachingError(
        `dashcards[${index}]: position (row ${dashcard.row}, col ${dashcard.col}) with size_x ${size.size_x} runs off the ${GRID_WIDTH}-column grid.`,
      );
    }
  }
  return write;
}

function contentSourceOf(index: number, dashcard: LayoutDashcard): ContentSource | null {
  const provided = CONTENT_SOURCES.filter((key) => dashcard[key] !== undefined);
  if (provided.length > 1) {
    throw new TeachingError(
      `dashcards[${index}]: provide exactly one content source (${CONTENT_SOURCES.join(", ")}); received ${provided.length}.`,
    );
  }
  const source = provided[0];
  if (source !== undefined) {
    return source;
  }
  if (virtualDisplayOf(dashcard.visualization_settings ?? {}) !== "") {
    return null;
  }
  throw new TeachingError(
    `dashcards[${index}]: a dashcard needs a content source — one of ${CONTENT_SOURCES.join(", ")}.`,
  );
}

function displayOf(
  index: number,
  dashcard: LayoutDashcard,
  source: ContentSource | null,
  context: LayoutContext,
): string {
  if (source === "card_id" && dashcard.card_id !== undefined) {
    const facts = context.cards.get(dashcard.card_id);
    if (facts === undefined) {
      throw new TeachingError(
        `dashcards[${index}]: card ${dashcard.card_id} does not exist or is not readable.`,
      );
    }
    return facts.display;
  }
  if (source === "text") {
    return "text";
  }
  if (source === "heading") {
    return "heading";
  }
  if (source === "link") {
    return "link";
  }
  if (source === "iframe") {
    return "iframe";
  }
  if (source === "action_id") {
    return "action";
  }
  return virtualDisplayOf(dashcard.visualization_settings ?? {});
}

function sizeOf(index: number, dashcard: LayoutDashcard, display: string): CardSize {
  const fallback = CARD_SIZE_DEFAULTS.get(display) ?? FALLBACK_CARD_SIZE;
  const size: CardSize = {
    size_x: dashcard.size_x ?? fallback.size_x,
    size_y: dashcard.size_y ?? fallback.size_y,
  };
  if (size.size_x < 1 || size.size_x > GRID_WIDTH || size.size_y < 1) {
    throw new TeachingError(
      `dashcards[${index}]: size ${size.size_x}x${size.size_y} is off the grid — size_x must be 1..${GRID_WIDTH} and size_y at least 1.`,
    );
  }
  return size;
}

function tabIdOf(index: number, dashcard: LayoutDashcard, tabs: CompiledTabs): number | null {
  if (dashcard.tab_id === undefined) {
    return tabs.firstId;
  }
  if (!tabs.ids.has(dashcard.tab_id)) {
    throw new TeachingError(
      `dashcards[${index}]: tab_id ${dashcard.tab_id} is not a tab in this layout — reference a tab by the \`id\` it carries in \`tabs\`.`,
    );
  }
  return dashcard.tab_id;
}

function virtualCard(display: string): VisualizationSettings {
  return { name: null, display, visualization_settings: {}, dataset_query: {}, archived: false };
}

function virtualSettings(
  index: number,
  dashcard: LayoutDashcard,
  source: ContentSource | null,
  settings: VisualizationSettings,
  context: LayoutContext,
): VisualizationSettings {
  if (source === "card_id" || source === "action_id" || source === null) {
    return { ...settings };
  }
  if (source === "text" && dashcard.text !== undefined) {
    return { ...settings, virtual_card: virtualCard("text"), text: dashcard.text };
  }
  if (source === "heading" && dashcard.heading !== undefined) {
    return {
      "dashcard.background": false,
      ...settings,
      virtual_card: virtualCard("heading"),
      text: dashcard.heading,
    };
  }
  if (source === "iframe" && dashcard.iframe !== undefined) {
    return { ...settings, virtual_card: virtualCard("iframe"), iframe: dashcard.iframe };
  }
  if (source === "link" && dashcard.link !== undefined) {
    return {
      ...settings,
      virtual_card: virtualCard("link"),
      link: linkSettings(index, dashcard.link, context),
    };
  }
  throw new TeachingError(`dashcards[${index}]: \`${String(source)}\` is empty.`);
}

function linkSettings(
  index: number,
  link: LayoutLink,
  context: LayoutContext,
): VisualizationSettings {
  const hasUrl = link.url !== undefined;
  const hasEntity = link.entity !== undefined;
  if (hasUrl === hasEntity) {
    throw new TeachingError(
      `dashcards[${index}]: a link takes exactly one of \`url\` or \`entity\`.`,
    );
  }
  if (link.url !== undefined) {
    return { url: link.url };
  }
  if (link.entity === undefined) {
    throw new TeachingError(
      `dashcards[${index}]: a link takes exactly one of \`url\` or \`entity\`.`,
    );
  }
  const entity = context.linkEntities.get(linkEntityKey(link.entity.type, link.entity.id));
  if (entity === undefined) {
    throw new TeachingError(
      `dashcards[${index}]: ${link.entity.type} ${link.entity.id} does not exist or is not readable.`,
    );
  }
  return { entity };
}

const TEXT_TAG_DISPLAYS: ReadonlySet<string> = new Set(["text", "heading"]);

function resolveMapping(
  index: number,
  mapping: LayoutMapping,
  cardId: number | null,
  display: string,
  parameterIds: ReadonlySet<string>,
  context: LayoutContext,
): ParameterMapping {
  if (!parameterIds.has(mapping.parameter_id)) {
    throw new TeachingError(
      `dashcards[${index}]: parameter_mappings names parameter "${mapping.parameter_id}", which is not a parameter in this layout — ${knownIds(parameterIds)}.`,
    );
  }
  return ParameterMapping.parse({
    parameter_id: mapping.parameter_id,
    card_id: cardId,
    target: resolveTarget(index, mapping, cardId, display, context),
  });
}

function resolveTarget(
  index: number,
  mapping: LayoutMapping,
  cardId: number | null,
  display: string,
  context: LayoutContext,
): ParameterTarget {
  const sources = [mapping.target_field, mapping.target_tag, mapping.target].filter(
    (value) => value !== undefined,
  );
  if (sources.length !== 1) {
    throw new TeachingError(
      `dashcards[${index}]: a parameter mapping takes exactly one of \`target_field\`, \`target_tag\`, or \`target\`; received ${sources.length}.`,
    );
  }
  if (mapping.target !== undefined) {
    return ParameterTarget.parse(mapping.target);
  }
  if (mapping.target_field !== undefined) {
    if (cardId === null) {
      throw new TeachingError(
        `dashcards[${index}]: a text or heading card has no fields — map it with \`target_tag\` naming its {{tag}}.`,
      );
    }
    return ParameterTarget.parse(["dimension", ["field", mapping.target_field, null]]);
  }
  const tag = mapping.target_tag;
  if (tag === undefined) {
    throw new TeachingError(`dashcards[${index}]: \`target_tag\` is required.`);
  }
  if (cardId === null) {
    if (!TEXT_TAG_DISPLAYS.has(display)) {
      throw new TeachingError(`dashcards[${index}]: this dashcard takes no parameters.`);
    }
    return ParameterTarget.parse(["text-tag", tag]);
  }
  const facts = context.cards.get(cardId);
  const kind = facts?.templateTags.get(tag);
  if (kind === undefined) {
    const declared = [...(facts?.templateTags.keys() ?? [])];
    const known =
      declared.length === 0
        ? "it declares no template tags — map it with `target_field` instead"
        : `it declares ${declared.map((name) => `\`${name}\``).join(", ")}`;
    throw new TeachingError(
      `dashcards[${index}]: card ${cardId} has no template tag "${tag}" — ${known}.`,
    );
  }
  return ParameterTarget.parse([kind, ["template-tag", tag]]);
}

// Explicitly positioned cards claim their slots first; the rest fill in file order, per tab.
function autoplaceDashcards(layout: readonly LayoutDashcard[], writes: DashcardWrite[]): void {
  const pending: number[] = [];
  for (const [index, dashcard] of layout.entries()) {
    if (dashcard.row === undefined && dashcard.col === undefined) {
      pending.push(index);
    }
  }
  for (const index of pending) {
    const write = writes[index];
    if (write === undefined) {
      continue;
    }
    const occupied = writes.filter(
      (candidate) =>
        candidate !== write &&
        candidate.dashboard_tab_id === write.dashboard_tab_id &&
        candidate.row >= 0,
    );
    const placed = autoplace(occupied, { size_x: write.size_x, size_y: write.size_y });
    write.row = placed.row;
    write.col = placed.col;
  }
}

interface Placement {
  row: number;
  col: number;
}

export function autoplace(occupied: readonly DashcardWrite[], size: CardSize): Placement {
  for (let row = 0; row < MAX_AUTOPLACE_ROWS; row += 1) {
    for (let col = 0; col <= GRID_WIDTH - size.size_x; col += 1) {
      const candidate = { row, col, size_x: size.size_x, size_y: size.size_y };
      if (!occupied.some((dashcard) => intersects(dashcard, candidate))) {
        return { row, col };
      }
    }
  }
  throw new TeachingError(
    `No free ${size.size_x}x${size.size_y} slot in the first ${MAX_AUTOPLACE_ROWS} rows — set an explicit \`row\`/\`col\`.`,
  );
}

interface Rect {
  row: number;
  col: number;
  size_x: number;
  size_y: number;
}

function intersects(a: Rect, b: Rect): boolean {
  const apart =
    b.col >= a.col + a.size_x ||
    b.col + b.size_x <= a.col ||
    b.row >= a.row + a.size_y ||
    b.row + b.size_y <= a.row;
  return !apart;
}

const VirtualCardSettings = z
  .object({ virtual_card: z.object({ display: z.string() }).loose() })
  .loose();

function virtualDisplayOf(settings: VisualizationSettings): string {
  const parsed = VirtualCardSettings.safeParse(settings);
  return parsed.success ? parsed.data.virtual_card.display : "";
}

function knownIds(ids: ReadonlySet<string>): string {
  if (ids.size === 0) {
    return "the layout declares none";
  }
  return `the layout declares ${[...ids].map((id) => `"${id}"`).join(", ")}`;
}

function mintParameterId(name: string, taken: ReadonlySet<string>): string {
  const base = slugify(name);
  if (!taken.has(base)) {
    return base;
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}_${suffix}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

const SECTION_PREFIXES: ReadonlyMap<string, string> = new Map([
  ["date", "date"],
  ["number", "number"],
  ["location", "location"],
  ["string", "string"],
  ["boolean", "boolean"],
]);

function sectionIdFor(type: ParameterType): string {
  if (type === "id") {
    return "id";
  }
  if (type === "temporal-unit") {
    return "date";
  }
  const head = type.split("/")[0] ?? type;
  return SECTION_PREFIXES.get(head) ?? "string";
}

function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug === "" ? "parameter" : slug;
}

// The pull projection: the exact document `compileDashboardLayout` accepts, produced from live
// state, so pull → edit → update round-trips.
export function buildEditableLayout(state: DashboardState): EditableLayout {
  const layout: EditableLayout = {
    dashcards: state.dashcards.map((dashcard) => projectDashcard(dashcard)),
  };
  if (state.tabs.length > 0) {
    layout.tabs = state.tabs.map((tab) => ({ id: tab.id, name: tab.name }));
  }
  if (state.parameters.length > 0) {
    layout.parameters = state.parameters.map((parameter) =>
      LayoutParameter.parse(projectParameter(parameter)),
    );
  }
  return layout;
}

// LayoutParameter is strict; the live Parameter is loose. Project down to the editable fields.
function projectParameter(parameter: Parameter): Record<string, unknown> {
  const editable: Record<string, unknown> = {};
  for (const key of Object.keys(LayoutParameter.shape)) {
    const value = parameter[key];
    if (value !== undefined) {
      editable[key] = value;
    }
  }
  if (editable["name"] === undefined) {
    editable["name"] = parameter.id;
  }
  return editable;
}

const MODEL_TO_LINK_TYPE: ReadonlyMap<string, LinkEntityType> = new Map([
  ["card", "question"],
  ["dataset", "model"],
  ["metric", "metric"],
  ["dashboard", "dashboard"],
  ["collection", "collection"],
  ["table", "table"],
]);

const StoredLink = z
  .object({
    link: z
      .object({
        url: z.string().optional(),
        entity: z.object({ id: z.number().int(), model: z.string() }).loose().optional(),
      })
      .loose(),
  })
  .loose();

const StoredText = z.object({ text: z.string() }).loose();
const StoredIframe = z.object({ iframe: z.string() }).loose();

function projectDashcard(dashcard: Dashcard): LayoutDashcard {
  const settings = VisualizationSettings.parse(dashcard.visualization_settings ?? {});
  const projected: LayoutDashcard = {
    id: dashcard.id,
    row: dashcard.row,
    col: dashcard.col,
    size_x: dashcard.size_x,
    size_y: dashcard.size_y,
  };
  if (dashcard.dashboard_tab_id !== null) {
    projected.tab_id = dashcard.dashboard_tab_id;
  }

  const rest = projectContent(dashcard, settings, projected);
  if (Object.keys(rest).length > 0) {
    projected.visualization_settings = rest;
  }

  const mappings = dashcard.parameter_mappings ?? [];
  if (mappings.length > 0) {
    projected.parameter_mappings = mappings.map((mapping) => ({
      parameter_id: mapping.parameter_id,
      target: mapping.target,
    }));
  }
  const inline = dashcard.inline_parameters ?? [];
  if (inline.length > 0) {
    projected.inline_parameters = inline;
  }
  return projected;
}

const StoredSeries = z
  .object({ series: z.array(z.object({ id: z.number().int() }).loose()).nullish() })
  .loose();

// Fills the content-source field on the projection and returns the visualization settings that
// remain once the sugared keys are lifted out.
function projectContent(
  dashcard: Dashcard,
  settings: VisualizationSettings,
  projected: LayoutDashcard,
): VisualizationSettings {
  if (dashcard.card_id !== null) {
    projected.card_id = dashcard.card_id;
    const series = (StoredSeries.parse(dashcard).series ?? []).map((entry) => entry.id);
    if (series.length > 0) {
      projected.series = series;
    }
    return { ...settings };
  }
  if (dashcard.action_id !== null && dashcard.action_id !== undefined) {
    projected.action_id = dashcard.action_id;
    return { ...settings };
  }

  const display = virtualDisplayOf(settings);
  if (display === "text" || display === "heading") {
    const text = StoredText.safeParse(settings);
    if (text.success) {
      if (display === "text") {
        projected.text = text.data.text;
        return omit(settings, ["virtual_card", "text"]);
      }
      projected.heading = text.data.text;
      const rest = omit(settings, ["virtual_card", "text"]);
      // The compiler re-adds the heading default; a non-default value stays in the file.
      return rest["dashcard.background"] === false ? omit(rest, ["dashcard.background"]) : rest;
    }
  }
  if (display === "iframe") {
    const iframe = StoredIframe.safeParse(settings);
    if (iframe.success) {
      projected.iframe = iframe.data.iframe;
      return omit(settings, ["virtual_card", "iframe"]);
    }
  }
  if (display === "link") {
    const stored = StoredLink.safeParse(settings);
    const sugared = stored.success ? projectLink(stored.data.link) : null;
    if (sugared !== null) {
      projected.link = sugared;
      return omit(settings, ["virtual_card", "link"]);
    }
  }
  return { ...settings };
}

interface StoredLinkValue {
  url?: string | undefined;
  entity?: { id: number; model: string } | undefined;
}

function projectLink(link: StoredLinkValue): LayoutLink | null {
  if (link.url !== undefined) {
    return { url: link.url };
  }
  if (link.entity !== undefined) {
    const type = MODEL_TO_LINK_TYPE.get(link.entity.model);
    if (type !== undefined) {
      return { entity: { type, id: link.entity.id } };
    }
  }
  return null;
}

function omit(settings: VisualizationSettings, keys: readonly string[]): VisualizationSettings {
  const dropped = new Set(keys);
  const rest: VisualizationSettings = {};
  for (const [key, value] of Object.entries(settings)) {
    if (!dropped.has(key)) {
      rest[key] = value;
    }
  }
  return rest;
}
