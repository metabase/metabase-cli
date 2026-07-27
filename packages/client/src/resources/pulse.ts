import { z } from "zod";

import { Pulse, type PulseCreateInput, type PulseUpdateInput } from "../domain/pulse";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";

// `GET /api/pulse` answers a bare array rather than a `{ data, total }` envelope, so the count a
// caller reads off `ListResult` is the array's own length and the server reports none.
const PulseApiList = z.array(Pulse);

export interface PulseListParams {
  dashboard_id?: number | undefined;
  archived?: boolean | undefined;
}

// `PUT /api/pulse/:id` applies the server's schema defaults to keys the body omits, and both
// `archived` and `skip_if_empty` default to false. A patch that leaves them out therefore
// un-archives the pulse and clears skip_if_empty behind the caller's back. Every update carries
// both forward from the stored pulse unless the caller sets them explicitly. The remaining fields
// (`name`, `cards`, `channels`, `collection_id`, `parameters`) are optional server-side and survive
// an omission untouched.
export function mergePulseUpdate(current: Pulse, patch: PulseUpdateInput): PulseUpdateInput {
  return {
    ...patch,
    archived: patch.archived ?? current.archived,
    skip_if_empty: patch.skip_if_empty ?? current.skip_if_empty,
  };
}

// Every path parameter here is a numeric id, so no fragment needs `encodeURIComponent`.
export function pulseResource(transport: Transport) {
  /** List dashboard subscriptions, optionally narrowed to one dashboard or to the archived ones. */
  async function list(
    params: PulseListParams = {},
    options: RequestOptions = {},
  ): Promise<ListResult<Pulse>> {
    const data = await transport.requestParsed(PulseApiList, "/api/pulse", {
      ...options,
      query: { dashboard_id: params.dashboard_id, archived: params.archived },
    });
    return { data, total: null };
  }

  /** Get one dashboard subscription by id. */
  async function get(id: number, options: RequestOptions = {}): Promise<Pulse> {
    return transport.requestParsed(Pulse, `/api/pulse/${id}`, { ...options });
  }

  /** Create a dashboard subscription — its cards and its delivery channels — from a full body. */
  async function create(params: PulseCreateInput, options: RequestOptions = {}): Promise<Pulse> {
    return transport.requestParsed(Pulse, "/api/pulse", {
      ...options,
      method: "POST",
      body: params,
    });
  }

  /** Update a dashboard subscription by id, carrying the server-defaulted flags forward. */
  async function update(
    id: number,
    params: PulseUpdateInput,
    options: RequestOptions = {},
  ): Promise<Pulse> {
    const current = await get(id, options);
    return transport.requestParsed(Pulse, `/api/pulse/${id}`, {
      ...options,
      method: "PUT",
      body: mergePulseUpdate(current, params),
    });
  }

  /**
   * Archive a dashboard subscription by id, stopping every delivery. Metabase models this as an
   * update, and disables each of the subscription's channels as a side effect.
   */
  async function archive(id: number, options: RequestOptions = {}): Promise<Pulse> {
    return update(id, { archived: true }, options);
  }

  return { list, get, create, update, archive };
}
