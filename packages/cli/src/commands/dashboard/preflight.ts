import type { MetabaseClient } from "@metabase/client/client";
import { ConfigError, MetabaseError } from "@metabase/client/errors";
import { chainRequestFailure } from "@metabase/client/http/errors";
import type { DashcardCardIssue } from "@metabase/client/resources/dashboard";

import { ValidationIssue, ValidationOutcome } from "../../core/schema/validate";
import { writeJson } from "../../output/render";

export async function preflightDashcardCardReferences(
  client: MetabaseClient,
  dashcards: ReadonlyArray<unknown> | null | undefined,
): Promise<void> {
  const issues = await client.dashboard.checkCardReferences(dashcards);
  if (issues.length === 0) {
    return;
  }
  const errors: ValidationIssue[] = issues.map((issue) => ({
    path: issue.path,
    message: describeIssue(issue),
  }));
  const outcome: ValidationOutcome = { ok: false, errors };
  writeJson(outcome);
  throw new ConfigError(
    `dashboard card-reference pre-flight failed: ${errors.length} error(s) — fix the dashcard card_id values listed above`,
  );
}

export function wrapChainedDashboardWriteError(error: unknown, dashboardId: number): unknown {
  if (!(error instanceof MetabaseError)) {
    return error;
  }
  const prefix = `dashboard ${dashboardId} created but the follow-up update to dashboard ${dashboardId} failed`;
  const suffix = "dashcards not applied";
  return chainRequestFailure(error, `${prefix}: ${error.userMessage}; ${suffix}`);
}

function describeIssue(issue: DashcardCardIssue): string {
  if (issue.problem.reason === "missing") {
    return `card ${issue.cardId} not found`;
  }
  if (issue.problem.reason === "archived") {
    return `card ${issue.cardId} is archived`;
  }
  return `card ${issue.cardId} is not readable: ${issue.problem.detail}`;
}
