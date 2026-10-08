import { ConfigError } from "@metabase/client/errors";
import {
  assertNotLegacyEnvelopeWrappingMbql5,
  isMbql5Query,
  validateQuery,
} from "../core/schema/validate";
import { writeJson } from "../output/render";

export const skipValidateFlag = {
  "skip-validate": {
    type: "boolean",
    description:
      "Skip the local MBQL 5 pre-flight validation; let the server be the authority. Use only when the bundled schema disagrees with what the server accepts.",
  },
} as const;

interface PreflightLabels {
  readonly contextLabel: string;
  readonly bodyNoun: string;
}

export const CARD_DATASET_QUERY_LABELS: PreflightLabels = {
  contextLabel: "card.dataset_query validation failed",
  bodyNoun: "dataset_query",
};

export const DATA_ACTION_DATASET_QUERY_LABELS: PreflightLabels = {
  contextLabel: "dataAction.dataset_query validation failed",
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

interface PreflightOptions {
  readonly skip: boolean;
}

// Only an `mbql/query` body has a bundled schema; a legacy `{type: …}` body goes out unchecked.
export function preflightMbql5Query(
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
  const outcome = validateQuery(query);
  if (outcome.ok) {
    return;
  }
  writeJson(outcome);
  throw new ConfigError(
    `${labels.contextLabel}: ${outcome.errors.length} error(s) — fix them, or pass --skip-validate to send anyway`,
  );
}
