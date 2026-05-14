import { CardQueryResult } from "../../src/domain/card";

type CompletedCardQueryResult = CardQueryResult & { data: NonNullable<CardQueryResult["data"]> };

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
