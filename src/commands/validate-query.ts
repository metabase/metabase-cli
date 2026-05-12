import { ConfigError } from "../core/errors";
import {
  assertNotLegacyEnvelopeWrappingMbql5,
  isMbql5Query,
  validateInternalQuery,
} from "../core/schema/validate";
import { writeJson } from "../output/render";

export const skipValidateFlag = {
  "skip-validate": {
    type: "boolean",
    description:
      "Skip the local MBQL 5 pre-flight validation; let the server be the authority. Use only when the bundled schema disagrees with what the server accepts.",
  },
} as const;

export interface PreflightLabels {
  readonly contextLabel: string;
  readonly bodyNoun: string;
}

export const CARD_DATASET_QUERY_LABELS: PreflightLabels = {
  contextLabel: "card.dataset_query validation failed",
  bodyNoun: "dataset_query",
};

export const TRANSFORM_SOURCE_QUERY_LABELS: PreflightLabels = {
  contextLabel: "transform.source.query validation failed",
  bodyNoun: "source.query",
};

export const MEASURE_DEFINITION_LABELS: PreflightLabels = {
  contextLabel: "measure.definition validation failed",
  bodyNoun: "definition",
};

export const SEGMENT_DEFINITION_LABELS: PreflightLabels = {
  contextLabel: "segment.definition validation failed",
  bodyNoun: "definition",
};

export interface PreflightOptions {
  readonly skip: boolean;
}

// Skips MBQL 4 / native — we only have a schema for MBQL 5 today, and the
// legacy formats are still accepted by the server.
export function preflightInternalMbql5Query(
  query: unknown,
  labels: PreflightLabels,
  options: PreflightOptions,
): void {
  if (options.skip) {
    return;
  }
  assertNotLegacyEnvelopeWrappingMbql5(query, labels);
  if (!isMbql5Query(query)) {
    return;
  }
  const outcome = validateInternalQuery(query);
  if (outcome.ok) {
    return;
  }
  writeJson(outcome);
  throw new ConfigError(
    `${labels.contextLabel}: ${outcome.errors.length} error(s) — pass valid MBQL 5 or use the legacy format`,
  );
}
