import { z } from "zod";

import {
  Dashboard,
  type DashboardCreateInput,
  DashboardDetail,
  type DashboardListFilter,
  type DashboardUpdateInput,
  Dashcard,
  type DashcardPatchInput,
} from "../domain/dashboard";
import { ParameterValues } from "../domain/parameter";
import { ConfigError } from "../errors";
import { HttpError } from "../http/errors";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";

import { cardResource } from "./card";

// `GET /api/dashboard` answers a bare array rather than a `{ data, total }` envelope, so the count a
// caller reads off `ListResult` is the array's own length and the server reports none.
const DashboardApiList = z.array(Dashboard);

// A dashcard as the reference check reads it: the id it points at, whatever else the caller is about
// to send. The write shapes carry `card_id` under a loose catchall, so it arrives untyped.
const PreflightDashcard = z.looseObject({
  card_id: z.number().int().nullable().optional(),
});

export interface DashboardListParams {
  f?: DashboardListFilter | undefined;
}

export interface DashcardCardMissing {
  reason: "missing";
}

export interface DashcardCardArchived {
  reason: "archived";
}

export interface DashcardCardUnreadable {
  reason: "unreadable";
  detail: string;
}

export type DashcardCardProblem =
  | DashcardCardMissing
  | DashcardCardArchived
  | DashcardCardUnreadable;

export interface DashcardCardIssue {
  cardId: number;
  path: string;
  problem: DashcardCardProblem;
}

interface CardReference {
  cardId: number;
  path: string;
}

interface ReferenceCheck {
  references: CardReference[];
  problem: DashcardCardProblem | null;
}

type DashcardWriteInput = NonNullable<DashboardUpdateInput["dashcards"]>[number];

export function dashboardResource(transport: Transport) {
  const card = cardResource(transport);

  /** List dashboards. `f` picks a server-side preset. */
  async function list(
    params: DashboardListParams = {},
    options: RequestOptions = {},
  ): Promise<ListResult<Dashboard>> {
    const data = await transport.requestParsed(DashboardApiList, "/api/dashboard", {
      ...options,
      query: { f: params.f },
    });
    return { data, total: null };
  }

  /** Get one dashboard by id, with its dashcards, tabs and parameters. */
  async function get(id: number, options: RequestOptions = {}): Promise<DashboardDetail> {
    return transport.requestParsed(DashboardDetail, `/api/dashboard/${id}`, { ...options });
  }

  /**
   * Create a dashboard. The endpoint accepts no dashcards or tabs — a follow-up `update` is what
   * puts content on a fresh dashboard.
   */
  async function create(
    params: DashboardCreateInput,
    options: RequestOptions = {},
  ): Promise<Dashboard> {
    return transport.requestParsed(Dashboard, "/api/dashboard", {
      ...options,
      method: "POST",
      body: params,
    });
  }

  /**
   * Update a dashboard by id, patching only the fields the body carries. `dashcards` and `tabs` are
   * full replacements: whatever the body omits is deleted from the dashboard.
   */
  async function update(
    id: number,
    params: DashboardUpdateInput,
    options: RequestOptions = {},
  ): Promise<DashboardDetail> {
    return transport.requestParsed(DashboardDetail, `/api/dashboard/${id}`, {
      ...options,
      method: "PUT",
      body: params,
    });
  }

  /**
   * Archive (soft-delete) a dashboard by id. Metabase models this as an update, not its own
   * endpoint. The answer is read as `Dashboard` rather than the `DashboardDetail` `update` returns:
   * an archive is a state change on the dashboard itself, and its dashcards are not part of it.
   */
  async function archive(id: number, options: RequestOptions = {}): Promise<Dashboard> {
    return transport.requestParsed(Dashboard, `/api/dashboard/${id}`, {
      ...options,
      method: "PUT",
      body: { archived: true },
    });
  }

  /**
   * Patch one dashcard on a dashboard. Metabase exposes no dashcard endpoint and its dashboard PUT
   * is a full replace of `dashcards`, so the patch is read-modify-written over the dashboard as it
   * currently stands.
   */
  async function updateDashcard(
    dashboardId: number,
    dashcardId: number,
    params: DashcardPatchInput,
    options: RequestOptions = {},
  ): Promise<Dashcard> {
    const dashboard = await get(dashboardId, options);
    const target = dashboard.dashcards.find((dashcard) => dashcard.id === dashcardId);
    if (target === undefined) {
      throw new ConfigError(`dashcard ${dashcardId} not found on dashboard ${dashboardId}`);
    }
    const patched = Dashcard.parse({ ...target, ...params });
    const dashcards = dashboard.dashcards.map((dashcard) =>
      stripEntityId(dashcard.id === dashcardId ? patched : dashcard),
    );
    const result = await update(dashboardId, { dashcards }, options);
    const refreshed = result.dashcards.find((dashcard) => dashcard.id === dashcardId);
    if (refreshed === undefined) {
      throw new Error(
        `PUT /api/dashboard/${dashboardId}: dashcard ${dashcardId} missing from response`,
      );
    }
    return refreshed;
  }

  /**
   * Check every card a `dashcards` body references before writing it, through `GET /api/card/{id}`
   * once per distinct id. Reports one issue per reference whose card is missing, archived, or
   * unreadable, so an empty result means the body is safe to send; an id the server answers for in
   * any other way propagates as the failure it was.
   */
  async function checkCardReferences(
    dashcards: ReadonlyArray<unknown> | null | undefined,
    options: RequestOptions = {},
  ): Promise<DashcardCardIssue[]> {
    const grouped = groupByCardId(collectCardReferences(dashcards));
    const checks = await Promise.all(
      Array.from(grouped.entries()).map(
        async ([cardId, references]): Promise<ReferenceCheck> => ({
          references,
          problem: await inspectCard(cardId, options),
        }),
      ),
    );
    return checks.flatMap((check) => {
      const problem = check.problem;
      if (problem === null) {
        return [];
      }
      return check.references.map((reference) => ({ ...reference, problem }));
    });
  }

  async function inspectCard(
    cardId: number,
    options: RequestOptions,
  ): Promise<DashcardCardProblem | null> {
    try {
      const found = await card.get(cardId, options);
      return found.archived ? { reason: "archived" } : null;
    } catch (error) {
      if (!(error instanceof HttpError)) {
        throw error;
      }
      // `resource-missing` rather than the bare 404: a `route-missing` 404 says this Metabase does
      // not serve card reads at all, and reporting that as "the card is gone" would be a lie.
      if (error.kind === "resource-missing") {
        return { reason: "missing" };
      }
      if (error.kind === "auth") {
        return { reason: "unreadable", detail: error.userMessage };
      }
      throw error;
    }
  }

  /**
   * Fetch the selectable values for a dashboard parameter, through the chain-filter value endpoint.
   */
  async function parameterValues(
    dashboardId: number,
    parameterId: string,
    options: RequestOptions = {},
  ): Promise<ParameterValues> {
    return transport.requestParsed(
      ParameterValues,
      `/api/dashboard/${dashboardId}/params/${encodeURIComponent(parameterId)}/values`,
      { ...options },
    );
  }

  /**
   * Search a dashboard parameter's selectable values: the server returns only values containing the
   * substring, capped at the first 1000 matches.
   */
  async function searchParameterValues(
    dashboardId: number,
    parameterId: string,
    query: string,
    options: RequestOptions = {},
  ): Promise<ParameterValues> {
    const parameter = encodeURIComponent(parameterId);
    return transport.requestParsed(
      ParameterValues,
      `/api/dashboard/${dashboardId}/params/${parameter}/search/${encodeURIComponent(query)}`,
      { ...options },
    );
  }

  return {
    list,
    get,
    create,
    update,
    archive,
    updateDashcard,
    checkCardReferences,
    parameterValues,
    searchParameterValues,
  };
}

// An entry the loose shape rejects is left to the server: the write is about to send it, and the
// error it comes back with says more than anything a pre-flight could invent about it.
function collectCardReferences(
  dashcards: ReadonlyArray<unknown> | null | undefined,
): CardReference[] {
  if (dashcards === undefined || dashcards === null) {
    return [];
  }
  const references: CardReference[] = [];
  dashcards.forEach((dashcard, index) => {
    const parsed = PreflightDashcard.safeParse(dashcard);
    if (!parsed.success) {
      return;
    }
    const cardId = parsed.data.card_id;
    if (typeof cardId === "number" && cardId > 0) {
      references.push({ cardId, path: `/dashcards/${index}/card_id` });
    }
  });
  return references;
}

function groupByCardId(references: ReadonlyArray<CardReference>): Map<number, CardReference[]> {
  const grouped = new Map<number, CardReference[]>();
  for (const reference of references) {
    const existing = grouped.get(reference.cardId);
    if (existing === undefined) {
      grouped.set(reference.cardId, [reference]);
    } else {
      existing.push(reference);
    }
  }
  return grouped;
}

// The five layout fields are named again on the way out because `Dashcard`'s loose catchall makes
// the rest-spread collapse every declared property into the index signature, and the write shape
// requires them.
function stripEntityId(dashcard: Dashcard): DashcardWriteInput {
  const { entity_id: _entity_id, id, size_x, size_y, row, col, ...rest } = dashcard;
  return { ...rest, id, size_x, size_y, row, col };
}
