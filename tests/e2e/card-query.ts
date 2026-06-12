import { CardQueryResult } from "../../src/domain/card";

type CompletedCardQueryResult = CardQueryResult & { data: NonNullable<CardQueryResult["data"]> };

const COMPACT_COLUMN_KEYS: ReadonlySet<string> = new Set([
  "name",
  "display_name",
  "base_type",
  "semantic_type",
]);

export function assertCompletedQuery(
  result: CardQueryResult,
): asserts result is CompletedCardQueryResult {
  if (result.status !== "completed") {
    throw new Error(`expected status "completed", got "${result.status}"`);
  }
  if (result.data === undefined) {
    throw new Error(`expected data to be defined; got: ${JSON.stringify(result)}`);
  }
}

// The compact projection keeps only name/display_name/base_type/semantic_type per column; any
// other key surviving in the printed output means the `.strip()` projection failed and the heavy
// per-column /api/dataset metadata (field_ref, fingerprint, lib/*) leaked through.
export function assertCompactColumns(result: CompletedCardQueryResult): void {
  for (const column of result.data.cols) {
    const extras = Object.keys(column).filter((key) => !COMPACT_COLUMN_KEYS.has(key));
    if (extras.length > 0) {
      throw new Error(
        `expected compact projection to drop column metadata; column "${column.name}" kept: ${extras.join(", ")}`,
      );
    }
  }
}
