import { z } from "zod";

import { ChainedRequestError, ConfigError, MetabaseError } from "../../core/errors";
import type { Client } from "../../core/http/client";
import { HttpError } from "../../core/http/errors";
import { ValidationIssue, ValidationOutcome } from "../../core/schema/validate";
import { Card } from "../../domain/card";
import { writeJson } from "../../output/render";

const PreflightDashcard = z.looseObject({
  card_id: z.number().int().nullable().optional(),
});

interface CardReference {
  cardId: number;
  path: string;
}

type CardCheck = { status: "ok" } | { status: "error"; message: string };

export function collectDashcardCardReferences(
  dashcards: ReadonlyArray<unknown> | undefined,
): CardReference[] {
  if (dashcards === undefined) {
    return [];
  }
  const refs: CardReference[] = [];
  dashcards.forEach((dashcard, index) => {
    const parsed = PreflightDashcard.safeParse(dashcard);
    if (!parsed.success) {
      return;
    }
    const cardId = parsed.data.card_id;
    if (typeof cardId === "number" && cardId > 0) {
      refs.push({ cardId, path: `/dashcards/${index}/card_id` });
    }
  });
  return refs;
}

export async function preflightDashcardCardReferences(
  client: Client,
  dashcards: ReadonlyArray<unknown> | undefined,
): Promise<void> {
  const references = collectDashcardCardReferences(dashcards);
  if (references.length === 0) {
    return;
  }
  const grouped = new Map<number, CardReference[]>();
  for (const ref of references) {
    const list = grouped.get(ref.cardId);
    if (list === undefined) {
      grouped.set(ref.cardId, [ref]);
    } else {
      list.push(ref);
    }
  }
  const checks = await Promise.all(
    Array.from(grouped.entries()).map(async ([cardId, refs]) => ({
      refs,
      result: await classifyCardReference(client, cardId),
    })),
  );
  const errors: ValidationIssue[] = [];
  for (const check of checks) {
    if (check.result.status === "ok") {
      continue;
    }
    for (const ref of check.refs) {
      errors.push({ path: ref.path, message: check.result.message });
    }
  }
  if (errors.length === 0) {
    return;
  }
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
  const prefix = `dashboard ${dashboardId} created but follow-up PUT /api/dashboard/${dashboardId} failed`;
  const suffix = "dashcards not applied";
  const message = `${prefix}: ${error.userMessage}; ${suffix}`;
  if (error instanceof HttpError) {
    return new HttpError({
      status: error.status,
      statusText: error.developerDetail.statusText,
      method: error.developerDetail.method,
      url: error.developerDetail.url,
      responseHeaders: error.developerDetail.responseHeaders,
      rawBody: error.developerDetail.body,
      overrideUserMessage: message,
    });
  }
  return new ChainedRequestError(message, error);
}

async function classifyCardReference(client: Client, cardId: number): Promise<CardCheck> {
  try {
    const card = await client.requestParsed(Card, `/api/card/${cardId}`);
    if (card.archived) {
      return { status: "error", message: `card ${cardId} is archived` };
    }
    return { status: "ok" };
  } catch (error) {
    if (!(error instanceof HttpError)) {
      throw error;
    }
    if (error.status === 404) {
      return { status: "error", message: `card ${cardId} not found` };
    }
    if (error.status === 401 || error.status === 403) {
      return { status: "error", message: `card ${cardId} is not readable: ${error.userMessage}` };
    }
    throw error;
  }
}
