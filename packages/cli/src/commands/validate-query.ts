import { ConfigError } from "@metabase/client/errors";
import { isPlainObject } from "@metabase/client/predicates";

import {
  assertNotLegacyEnvelopeWrappingMbql5,
  getQuerySchemaBundle,
  isMbql5Query,
  QUERY_SCHEMA_DOCUMENT,
  validateQuery,
} from "../core/schema/validate";
import { writeJson } from "../output/render";
import type { EmbeddedQuery, JsonSchemaSource } from "../runtime/command-augment";

export const skipValidateFlag = {
  "skip-validate": {
    type: "boolean",
    description:
      "Skip the local MBQL 5 pre-flight validation; let the server be the authority. Use only when the bundled schema disagrees with what the server accepts.",
  },
} as const;

export const QUERY_DOCUMENTS: JsonSchemaSource = {
  title: "MBQL 5 query",
  command: ["query"],
  documentName: QUERY_SCHEMA_DOCUMENT,
  bundle: getQuerySchemaBundle(),
};

// A python source is loose, so a stray `query` beside its body is not a query to check.
function hasQuerySource(body: unknown): boolean {
  return valueAt(body, ["source", "type"]) === "query";
}

export const CARD_DATASET_QUERY: EmbeddedQuery = {
  resource: "card",
  path: ["dataset_query"],
  when: null,
};
export const DATA_ACTION_DATASET_QUERY: EmbeddedQuery = {
  resource: "dataAction",
  path: ["dataset_query"],
  when: null,
};
export const TRANSFORM_SOURCE_QUERY: EmbeddedQuery = {
  resource: "transform",
  path: ["source", "query"],
  when: hasQuerySource,
};
export const MEASURE_DEFINITION: EmbeddedQuery = {
  resource: "measure",
  path: ["definition"],
  when: null,
};
export const SEGMENT_DEFINITION: EmbeddedQuery = {
  resource: "segment",
  path: ["definition"],
  when: null,
};

interface PreflightOptions {
  readonly skip: boolean;
}

// Only an `mbql/query` query has a bundled schema.
export function preflightEmbeddedQuery(
  body: unknown,
  embedded: EmbeddedQuery,
  options: PreflightOptions,
): void {
  const holdsNoQuery = embedded.when !== null && !embedded.when(body);
  if (options.skip || holdsNoQuery) {
    return;
  }
  const query = valueAt(body, embedded.path);
  const bodyNoun = embedded.path.join(".");
  const contextLabel = `${embedded.resource}.${bodyNoun} validation failed`;
  assertNotLegacyEnvelopeWrappingMbql5(query, { contextLabel, bodyNoun });
  if (!isMbql5Query(query)) {
    return;
  }
  const outcome = validateQuery(query);
  if (outcome.ok) {
    return;
  }
  writeJson(outcome);
  throw new ConfigError(
    `${contextLabel}: ${outcome.errors.length} error(s) — fix them, or pass --skip-validate to send anyway`,
  );
}

function valueAt(body: unknown, path: readonly string[]): unknown {
  let value = body;
  for (const key of path) {
    if (!isPlainObject(value)) {
      return undefined;
    }
    value = value[key];
  }
  return value;
}
