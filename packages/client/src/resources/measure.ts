import { z } from "zod";

import { Measure, type MeasureCreateInput, type MeasureUpdateInput } from "../domain/measure";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";

// `GET /api/measure` answers a bare array rather than a `{ data, total }` envelope, so the count a
// caller reads off `ListResult` is the array's own length and the server reports none.
const MeasureApiList = z.array(Measure);

export interface MeasureArchiveParams {
  revision_message: string;
}

export function measureResource(transport: Transport) {
  /** List measures. */
  async function list(options: RequestOptions = {}): Promise<ListResult<Measure>> {
    const data = await transport.requestParsed(MeasureApiList, "/api/measure", { ...options });
    return { data, total: null };
  }

  /** Get one measure by id. */
  async function get(id: number, options: RequestOptions = {}): Promise<Measure> {
    return transport.requestParsed(Measure, `/api/measure/${id}`, { ...options });
  }

  /** Create a measure — a saved aggregation tied to a table — from a full measure body. */
  async function create(
    params: MeasureCreateInput,
    options: RequestOptions = {},
  ): Promise<Measure> {
    return transport.requestParsed(Measure, "/api/measure", {
      ...options,
      method: "POST",
      body: params,
    });
  }

  /**
   * Update a measure by id, patching only the fields the body carries. `revision_message` is
   * required and lands in the audit log.
   */
  async function update(
    id: number,
    params: MeasureUpdateInput,
    options: RequestOptions = {},
  ): Promise<Measure> {
    return transport.requestParsed(Measure, `/api/measure/${id}`, {
      ...options,
      method: "PUT",
      body: params,
    });
  }

  /**
   * Archive (soft-delete) a measure by id. Metabase models this as an update, not its own endpoint,
   * so it carries the same required `revision_message`.
   */
  async function archive(
    id: number,
    params: MeasureArchiveParams,
    options: RequestOptions = {},
  ): Promise<Measure> {
    return update(id, { archived: true, revision_message: params.revision_message }, options);
  }

  return { list, get, create, update, archive };
}
