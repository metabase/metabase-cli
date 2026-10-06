import { z } from "zod";

import {
  Revision,
  type RevisionEntity,
  RevisionRevert,
  type RevisionRevertInput,
  RevisionRow,
} from "../domain/revision";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";
import type { FeatureName } from "../version/features";
import { explainer } from "../version/refusal";

// `GET /api/revision/{entity}/{id}` answers a bare array, newest first, that the server does not
// count.
const RevisionApiList = z.array(Revision);

// The two answers a revert gives share no required key, so the detailed one is tried first and the
// bare row is what remains.
const RevisionApiRevert: z.ZodType<RevisionRevert> = z.union([
  Revision.transform((revision) => ({ outcome: "reverted" as const, revision })),
  RevisionRow.transform((revision) => ({ outcome: "unchanged" as const, revision })),
]);

// An older server rejects an entity kind it does not revision (an unrouted 404, or a 400 on the
// enum), and the rejection is explained by the feature that brought the kind.
const ENTITY_FEATURES: Partial<Record<RevisionEntity, FeatureName>> = {
  measure: "measures",
  transform: "transforms",
};

function entityFeatures(entity: RevisionEntity): FeatureName[] {
  const feature = ENTITY_FEATURES[entity];
  return feature === undefined ? [] : [feature];
}

// Every path parameter here is an enum member or a numeric id, so no fragment needs
// `encodeURIComponent`.
export function revisionResource(transport: Transport) {
  const explain = explainer(transport, "revision");

  /** List the revisions of an entity the caller may read, newest first, each with its diff. */
  async function list(
    entity: RevisionEntity,
    id: number,
    options: RequestOptions = {},
  ): Promise<ListResult<Revision>> {
    const data = await transport.requestParsed(RevisionApiList, `/api/revision/${entity}/${id}`, {
      ...options,
    });
    return { data, total: null };
  }

  /**
   * Revert an entity to one of its prior revisions. Needs write access to the entity, and for a
   * card the permission to run the query being restored.
   */
  async function revert(
    params: RevisionRevertInput,
    options: RequestOptions = {},
  ): Promise<RevisionRevert> {
    return transport.requestParsed(RevisionApiRevert, "/api/revision/revert", {
      ...options,
      method: "POST",
      body: params,
    });
  }

  return {
    list: explain("list", list, entityFeatures),
    revert: explain("revert", revert, (params) => entityFeatures(params.entity)),
  };
}
