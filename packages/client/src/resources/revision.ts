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

// `GET /api/revision/{entity}/{id}` answers a bare array, newest first, that the server does not
// count.
const RevisionApiList = z.array(Revision);

// The two answers a revert gives share no required key, so the detailed one is tried first and the
// bare row is what remains.
const RevisionApiRevert: z.ZodType<RevisionRevert> = z.union([
  Revision.transform((revision) => ({ outcome: "reverted" as const, revision })),
  RevisionRow.transform((revision) => ({ outcome: "unchanged" as const, revision })),
]);

// An entity kind an older server does not revision is refused by the feature that brought it,
// rather than as that server's route-missing 404.
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
  /** List the revisions of an entity the caller may read, newest first, each with its diff. */
  async function list(
    entity: RevisionEntity,
    id: number,
    options: RequestOptions = {},
  ): Promise<ListResult<Revision>> {
    await transport.require("revision.list", options);
    await transport.requireFeatures(entityFeatures(entity), options);
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
    await transport.require("revision.revert", options);
    await transport.requireFeatures(entityFeatures(params.entity), options);
    return transport.requestParsed(RevisionApiRevert, "/api/revision/revert", {
      ...options,
      method: "POST",
      body: params,
    });
  }

  return { list, revert };
}
