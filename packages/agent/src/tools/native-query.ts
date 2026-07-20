import { createHash } from "node:crypto";
import { z } from "zod";
import { type JsonValue, jsonValueSchema } from "./json-value";
import { TeachingError } from "./teaching-error";

const TAG_OCCURRENCE = /\{\{([^{}]+)\}\}/g;
const UUID_GROUPS = [8, 4, 4, 4, 12] as const;

export const TEMPLATE_TAG_TYPES = [
  "text",
  "number",
  "date",
  "boolean",
  "dimension",
  "snippet",
  "card",
] as const;

const TemplateTagInput = z
  .object({
    type: z.enum(TEMPLATE_TAG_TYPES),
    id: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    "display-name": z.string().min(1).optional(),
  })
  .loose();

const TemplateTagsInput = z.record(z.string(), TemplateTagInput);
export type TemplateTagsInput = z.infer<typeof TemplateTagsInput>;

export interface NativeSource {
  database_id: number;
  sql: string;
  template_tags?: Record<string, unknown> | undefined;
}

export function buildNativeQuery(source: NativeSource): JsonValue {
  const declared = TemplateTagsInput.parse(source.template_tags ?? {});
  const used = tagOccurrences(source.sql);
  assertTagsMatch(used, new Set(Object.keys(declared)));

  const tags: Record<string, JsonValue> = {};
  for (const [name, tag] of Object.entries(declared)) {
    tags[name] = {
      ...tag,
      id: tag.id ?? deterministicUuid(name),
      name: tag.name ?? name,
      "display-name": tag["display-name"] ?? humanize(name),
    };
  }

  const stage: Record<string, JsonValue> = {
    "lib/type": "mbql.stage/native",
    native: source.sql,
  };
  if (Object.keys(tags).length > 0) {
    stage["template-tags"] = tags;
  }
  return { "lib/type": "mbql/query", database: source.database_id, stages: [stage] };
}

const StagedNativeQuery = z
  .object({
    "lib/type": z.literal("mbql/query"),
    database: z.number().int(),
    stages: z.tuple([
      z
        .object({
          "lib/type": z.literal("mbql.stage/native"),
          native: z.string(),
          "template-tags": z.record(z.string(), jsonValueSchema).optional(),
        })
        .loose(),
    ]),
  })
  .loose();

const LegacyNativeQuery = z
  .object({
    type: z.literal("native"),
    database: z.number().int(),
    native: z
      .object({
        query: z.string(),
        "template-tags": z.record(z.string(), jsonValueSchema).optional(),
      })
      .loose(),
  })
  .loose();

export interface NativeQueryParts {
  sql: string;
  databaseId: number;
  templateTags: Record<string, JsonValue>;
}

/**
 * The SQL inside a stored native query, when the query is nothing but that SQL — a single native
 * stage (or the legacy native envelope). Multi-stage queries stay whole: their SQL is one stage of
 * a larger body and cannot round-trip through `native.sql_file` alone.
 */
export function nativeQueryParts(datasetQuery: unknown): NativeQueryParts | null {
  const staged = StagedNativeQuery.safeParse(datasetQuery);
  if (staged.success) {
    const stage = staged.data.stages[0];
    return {
      sql: stage.native,
      databaseId: staged.data.database,
      templateTags: stage["template-tags"] ?? {},
    };
  }
  const legacy = LegacyNativeQuery.safeParse(datasetQuery);
  if (legacy.success) {
    return {
      sql: legacy.data.native.query,
      databaseId: legacy.data.database,
      templateTags: legacy.data.native["template-tags"] ?? {},
    };
  }
  return null;
}

export function tagOccurrences(sql: string): Set<string> {
  const names = new Set<string>();
  for (const match of sql.matchAll(TAG_OCCURRENCE)) {
    const inner = match[1];
    if (inner !== undefined && inner.trim() !== "") {
      names.add(inner.trim());
    }
  }
  return names;
}

function assertTagsMatch(used: ReadonlySet<string>, declared: ReadonlySet<string>): void {
  const missing = [...used].filter((name) => !declared.has(name));
  if (missing.length > 0) {
    throw new TeachingError(
      `The SQL references ${list(missing)} but \`native.template_tags\` declares no entry for ${missing.length === 1 ? "it" : "them"}. Every {{tag}} needs a tag body — a bare \`{{x}}\` filtering a real column is a field filter (\`{"type": "dimension", "dimension": ["field", {}, <field-id>], "widget-type": "string/="}\`); a value spliced into an expression is a raw variable (\`{"type": "text"}\`).`,
    );
  }
  const unused = [...declared].filter((name) => !used.has(name));
  if (unused.length > 0) {
    throw new TeachingError(
      `\`native.template_tags\` declares ${list(unused)} but the SQL never references ${unused.length === 1 ? "it" : "them"}. Add the {{tag}} to the SQL or drop the declaration.`,
    );
  }
}

function list(names: readonly string[]): string {
  return names.map((name) => `{{${name}}}`).join(", ");
}

function humanize(name: string): string {
  const words = name.replace(/[_-]+/g, " ").trim().split(/\s+/);
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

// Template-tag ids only need to be unique within a card, so hashing the tag name keeps
// the payload a pure function of its inputs — the same card body writes byte-identically twice.
function deterministicUuid(seed: string): string {
  const digest = createHash("sha256").update(seed).digest("hex");
  const parts: string[] = [];
  let offset = 0;
  for (const length of UUID_GROUPS) {
    parts.push(digest.slice(offset, offset + length));
    offset += length;
  }
  return parts.join("-");
}
