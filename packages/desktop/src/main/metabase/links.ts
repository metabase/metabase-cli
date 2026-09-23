import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parse } from "yaml";
import { z } from "zod";

import type {
  EidModel,
  EidTranslateInput,
  EidTranslateResult,
} from "@metabase/client/domain/eid-translation";

import {
  ContentKind,
  worktreeUrl,
  type ContentLink,
  type EntityKind,
  type MetabaseWorktree,
} from "../../contracts/metabase";

const YAML_SUFFIX = ".yaml";
const TRAILING_SLASHES = /\/+$/u;
const ENTITY_ID_LENGTH = 21;
const CARD_MODEL = "Card";
const DEFAULT_CARD_KIND: EntityKind = "question";

// The representation format's `serdes/meta` models, by the kind a person reads. A card is left out
// because its kind is its `type`.
const KIND_OF_MODEL: Readonly<Record<string, EntityKind>> = {
  Action: "action",
  Channel: "channel",
  Collection: "collection",
  Dashboard: "dashboard",
  Database: "database",
  Document: "document",
  Field: "field",
  Glossary: "glossary",
  Measure: "measure",
  Metabot: "metabot",
  NativeQuerySnippet: "snippet",
  PythonLibrary: "python-library",
  Segment: "segment",
  Table: "table",
  Timeline: "timeline",
  Transform: "transform",
  TransformJob: "transform-job",
  TransformTag: "transform-tag",
};

const KIND_OF_CARD_TYPE: Readonly<Record<string, EntityKind>> = {
  question: "question",
  model: "model",
  metric: "metric",
};

const PAGE_PATHS: Readonly<Record<ContentKind, string>> = {
  collection: "collection",
  dashboard: "dashboard",
  document: "document",
  metric: "metric",
  model: "model",
  question: "question",
  transform: "data-studio/transforms",
};

const EID_MODEL_OF_KIND: Readonly<Record<ContentKind, EidModel>> = {
  collection: "collection",
  dashboard: "dashboard",
  document: "document",
  metric: "card",
  model: "card",
  question: "card",
  transform: "transform",
};

const ContentFile = z
  .object({
    name: z.string().min(1),
    entity_id: z.string().length(ENTITY_ID_LENGTH).optional(),
    type: z.string().optional(),
    "serdes/meta": z.array(z.object({ model: z.string().min(1) }).loose()).min(1),
  })
  .loose();
type ContentFile = z.infer<typeof ContentFile>;

// `entityId` is null for the kinds Metabase addresses by path rather than by entity id, a table or
// a field.
export interface ContentEntity {
  readonly kind: EntityKind;
  readonly entityId: string | null;
  readonly name: string;
}

// Where a session reaches Metabase: the instance's address and the worktree its pages open in.
export interface MetabaseSite {
  readonly url: string;
  readonly worktree: MetabaseWorktree;
}

export function contentUrl(site: MetabaseSite, kind: ContentKind, id: number): string {
  const page = `${site.url.replace(TRAILING_SLASHES, "")}/${PAGE_PATHS[kind]}/${id}`;
  return worktreeUrl(page, site.worktree);
}

export function isContentYaml(path: string): boolean {
  return path.endsWith(YAML_SUFFIX);
}

function kindOf(file: ContentFile, model: string): EntityKind | null {
  if (model === CARD_MODEL) {
    return file.type === undefined ? DEFAULT_CARD_KIND : (KIND_OF_CARD_TYPE[file.type] ?? null);
  }
  return KIND_OF_MODEL[model] ?? null;
}

// The last `serdes/meta` entry is the entity the file holds; the ones before it contain it.
export function contentEntity(text: string): ContentEntity | null {
  const parsed = ContentFile.safeParse(parse(text));
  if (!parsed.success) {
    return null;
  }
  const meta = parsed.data["serdes/meta"];
  const model = meta[meta.length - 1]?.model;
  const kind = model === undefined ? null : kindOf(parsed.data, model);
  if (kind === null) {
    return null;
  }
  return { kind, entityId: parsed.data.entity_id ?? null, name: parsed.data.name };
}

// A YAML file that holds no entity is left out; the caller leaves out deleted files, which have
// nothing to open.
export async function readContentEntities(
  cwd: string,
  paths: readonly string[],
): Promise<ContentEntity[]> {
  const entities: ContentEntity[] = [];
  for (const path of paths.filter(isContentYaml)) {
    const entity = contentEntity(await readFile(join(cwd, path), "utf8"));
    if (entity !== null) {
      entities.push(entity);
    }
  }
  return entities;
}

interface LinkableEntity {
  readonly kind: ContentKind;
  readonly entityId: string;
  readonly name: string;
}

function linkable(entity: ContentEntity): LinkableEntity | null {
  const kind = ContentKind.safeParse(entity.kind);
  if (!kind.success || entity.entityId === null) {
    return null;
  }
  return { kind: kind.data, entityId: entity.entityId, name: entity.name };
}

export function translationRequest(entities: readonly ContentEntity[]): EidTranslateInput {
  const entityIds: Partial<Record<EidModel, string[]>> = {};
  for (const entity of entities) {
    const target = linkable(entity);
    if (target === null) {
      continue;
    }
    const model = EID_MODEL_OF_KIND[target.kind];
    entityIds[model] = [...(entityIds[model] ?? []), target.entityId];
  }
  return { entity_ids: entityIds };
}

export function translatedId(translated: EidTranslateResult, entityId: string): number | null {
  return translated.entity_ids[entityId]?.id ?? null;
}

// The link to the object's page, or null when Metabase does not hold it or gives its kind no page.
export function contentLink(
  site: MetabaseSite,
  entity: ContentEntity,
  translated: EidTranslateResult,
): ContentLink | null {
  const target = linkable(entity);
  if (target === null) {
    return null;
  }
  const id = translatedId(translated, target.entityId);
  if (id === null) {
    return null;
  }
  return { kind: target.kind, title: target.name, url: contentUrl(site, target.kind, id) };
}

export function contentLinks(
  site: MetabaseSite,
  entities: readonly ContentEntity[],
  translated: EidTranslateResult,
): ContentLink[] {
  return entities
    .map((entity) => contentLink(site, entity, translated))
    .filter((link) => link !== null);
}
