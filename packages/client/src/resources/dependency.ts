import { z } from "zod";

import {
  DependencyBackfillStatus,
  DependencyNode,
  type DependencyEntityType,
} from "../domain/dependency";
import type { RequestOptions, Transport } from "../http/transport";

const DependencyNodeList = z.array(DependencyNode);

export function dependencyResource(transport: Transport) {
  /** List the direct dependents of an entity. */
  async function dependents(
    type: DependencyEntityType,
    id: number,
    options: RequestOptions = {},
  ): Promise<DependencyNode[]> {
    return transport.requestParsed(DependencyNodeList, "/api/ee/dependencies/graph/dependents", {
      ...options,
      query: { type, id, "include-personal-collections": true },
    });
  }

  /** Report whether Metabase has finished indexing dependencies. */
  async function backfillStatus(options: RequestOptions = {}): Promise<DependencyBackfillStatus> {
    return transport.requestParsed(
      DependencyBackfillStatus,
      "/api/ee/dependencies/backfill-status",
      { ...options },
    );
  }

  return { dependents, backfillStatus };
}
