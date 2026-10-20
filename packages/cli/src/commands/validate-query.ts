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
import type { BodyPredicate, EmbeddedDocument, JsonSchemaSource } from "../runtime/command-augment";

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

function embeddedQuery(
  owner: string,
  path: readonly string[],
  when: BodyPredicate | null,
): EmbeddedDocument {
  return { owner, path, source: QUERY_DOCUMENTS, when };
}

// A python source is loose, so a stray `query` beside its body is not a query to check.
function hasQuerySource(body: unknown): boolean {
  return valueAt(body, ["source", "type"]) === "query";
}

export const CARD_DATASET_QUERY = embeddedQuery("card", ["dataset_query"], null);
export const DATA_ACTION_DATASET_QUERY = embeddedQuery("dataAction", ["dataset_query"], null);
export const TRANSFORM_SOURCE_QUERY = embeddedQuery(
  "transform",
  ["source", "query"],
  hasQuerySource,
);
export const MEASURE_DEFINITION = embeddedQuery("measure", ["definition"], null);
export const SEGMENT_DEFINITION = embeddedQuery("segment", ["definition"], null);

interface PreflightOptions {
  readonly skip: boolean;
}

// Only an `mbql/query` query has a bundled schema; a legacy `{type: …}` query, or a body with
// nothing at the query's path, goes out unchecked.
export function preflightEmbeddedQuery(
  body: unknown,
  embedded: EmbeddedDocument,
  options: PreflightOptions,
): void {
  if (options.skip || (embedded.when !== null && !embedded.when(body))) {
    return;
  }
  const query = valueAt(body, embedded.path);
  const bodyNoun = embedded.path.join(".");
  const contextLabel = `${embedded.owner}.${bodyNoun} validation failed`;
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
