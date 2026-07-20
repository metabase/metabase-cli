import { isRecord } from "./table";

/** The Metabase entities a reader can open in a browser, and this agent can name. */
export type EntityKind =
  | "question"
  | "model"
  | "metric"
  | "dashboard"
  | "collection"
  | "document"
  | "database"
  | "table"
  | "transform"
  | "transform_job"
  | "segment";

export interface EntityRef {
  kind: EntityKind;
  id: number | string;
  // A table is reached through its database, so a ref that has one produces a URL the instance can
  // open for any reader, rather than one only a data-model admin can.
  databaseId?: number | undefined;
}

/** `model` is the discriminator search and collection listings put on every row. */
const MODEL_KIND: Record<string, EntityKind> = {
  card: "question",
  dataset: "model",
  metric: "metric",
  dashboard: "dashboard",
  collection: "collection",
  document: "document",
  database: "database",
  table: "table",
  transform: "transform",
  segment: "segment",
};

/** A card carries its own kind, and the three kinds live at three different URLs. */
const CARD_TYPE_KIND: Record<string, EntityKind> = {
  question: "question",
  model: "model",
  metric: "metric",
};

/** A homogeneous listing names its rows once, in its noun; a write names the thing it wrote. */
const NOUN_KIND: Record<string, EntityKind> = {
  question: "question",
  questions: "question",
  model: "model",
  models: "model",
  metric: "metric",
  metrics: "metric",
  dashboard: "dashboard",
  dashboards: "dashboard",
  collection: "collection",
  collections: "collection",
  document: "document",
  documents: "document",
  database: "database",
  databases: "database",
  table: "table",
  tables: "table",
  transform: "transform",
  transforms: "transform",
  "transform job": "transform_job",
  "transform jobs": "transform_job",
  segment: "segment",
  segments: "segment",
};

/** The id column of a foreign key, and the nested entity the compact projections carry beside it. */
const FIELD_KIND: Record<string, EntityKind> = {
  collection: "collection",
  collection_id: "collection",
  database: "database",
  database_id: "database",
  db_id: "database",
  table: "table",
  table_id: "table",
  transform_id: "transform",
  card_id: "question",
  dashboard_id: "dashboard",
};

export function entityKindOfNoun(noun: string): EntityKind | null {
  return NOUN_KIND[noun] ?? null;
}

export function entityKindOfModel(model: string): EntityKind | null {
  return MODEL_KIND[model] ?? null;
}

export function entityKindOfField(field: string): EntityKind | null {
  return FIELD_KIND[field] ?? null;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function readId(value: unknown): number | string | null {
  if (typeof value === "number" || (typeof value === "string" && value !== "")) {
    return value;
  }
  return null;
}

function readDatabaseId(record: Record<string, unknown>): number | undefined {
  const value = record["database_id"] ?? record["db_id"];
  return typeof value === "number" ? value : undefined;
}

/**
 * What a listed row points at. The row says so itself when the listing mixes kinds (`model`) or the
 * endpoint serves three shapes under one resource (a card's `type`); otherwise the listing's noun
 * says it, and where nothing does, the row is text.
 */
export function entityRefOfRecord(value: unknown, noun: string | null): EntityRef | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readId(value["id"]);
  if (id === null) {
    return null;
  }
  const model = readString(value, "model");
  const cardType = readString(value, "type");
  const kind =
    (model === null ? null : MODEL_KIND[model]) ??
    (cardType === null ? null : CARD_TYPE_KIND[cardType]) ??
    (noun === null ? null : NOUN_KIND[noun]) ??
    null;
  if (kind === null) {
    return null;
  }
  return { kind, id, databaseId: readDatabaseId(value) };
}

/** A foreign key cell: either the bare id, or the nested entity the compact projection inlines. */
export function entityRefOfField(field: string, value: unknown): EntityRef | null {
  const kind = entityKindOfField(field);
  if (kind === null) {
    return null;
  }
  if (isRecord(value)) {
    const nested = readId(value["id"]);
    return nested === null ? null : { kind, id: nested, databaseId: readDatabaseId(value) };
  }
  const id = readId(value);
  return id === null ? null : { kind, id };
}
