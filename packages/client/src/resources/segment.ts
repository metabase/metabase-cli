import { z } from "zod";

import { Segment, type SegmentCreateInput, type SegmentUpdateInput } from "../domain/segment";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";

// `GET /api/segment` answers a bare array rather than a `{ data, total }` envelope, so the count a
// caller reads off `ListResult` is the array's own length and the server reports none.
const SegmentApiList = z.array(Segment);

export interface SegmentArchiveParams {
  revision_message: string;
}

// Every path parameter here is a numeric id, so no fragment needs `encodeURIComponent`.
export function segmentResource(transport: Transport) {
  /** List every segment the caller can see. */
  async function list(options: RequestOptions = {}): Promise<ListResult<Segment>> {
    const data = await transport.requestParsed(SegmentApiList, "/api/segment", { ...options });
    return { data, total: null };
  }

  /** Get one segment by id. */
  async function get(id: number, options: RequestOptions = {}): Promise<Segment> {
    return transport.requestParsed(Segment, `/api/segment/${id}`, { ...options });
  }

  /** Create a segment — a reusable row filter over one table — from a full segment body. */
  async function create(
    params: SegmentCreateInput,
    options: RequestOptions = {},
  ): Promise<Segment> {
    return transport.requestParsed(Segment, "/api/segment", {
      ...options,
      method: "POST",
      body: params,
    });
  }

  /**
   * Update a segment by id, patching only the fields the body carries. `revision_message` is
   * required: Metabase records every segment change in its revision history.
   */
  async function update(
    id: number,
    params: SegmentUpdateInput,
    options: RequestOptions = {},
  ): Promise<Segment> {
    return transport.requestParsed(Segment, `/api/segment/${id}`, {
      ...options,
      method: "PUT",
      body: params,
    });
  }

  /**
   * Archive (soft-delete) a segment by id. Metabase models this as an update, so it carries the
   * same required `revision_message`.
   */
  async function archive(
    id: number,
    params: SegmentArchiveParams,
    options: RequestOptions = {},
  ): Promise<Segment> {
    return update(id, { archived: true, revision_message: params.revision_message }, options);
  }

  return { list, get, create, update, archive };
}
