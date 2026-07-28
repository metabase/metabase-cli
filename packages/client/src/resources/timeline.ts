import { z } from "zod";

import {
  Timeline,
  type TimelineCreateInput,
  type TimelineEvent,
  type TimelineUpdateInput,
} from "../domain/timeline";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";

// `GET /api/timeline` answers a bare array rather than a `{ data, total }` envelope, so the count a
// caller reads off `ListResult` is the array's own length and the server reports none.
const TimelineApiList = z.array(Timeline);

// `include=events` is what fills the `events` field the bare timeline leaves optional, so the
// hydrated read parses against a schema that requires it rather than trusting the query string.
const TimelineWithEvents = Timeline.required({ events: true });

export interface TimelineListParams {
  archived?: boolean | undefined;
}

export interface TimelineEventsParams {
  archived?: boolean | undefined;
}

export function timelineResource(transport: Transport) {
  /** List timelines. `archived` swaps the active listing for the archived one. */
  async function list(
    params: TimelineListParams = {},
    options: RequestOptions = {},
  ): Promise<ListResult<Timeline>> {
    const data = await transport.requestParsed(TimelineApiList, "/api/timeline", {
      ...options,
      query: { archived: params.archived },
    });
    return { data, total: null };
  }

  /** Get one timeline by id, without its events. */
  async function get(id: number, options: RequestOptions = {}): Promise<Timeline> {
    return transport.requestParsed(Timeline, `/api/timeline/${id}`, { ...options });
  }

  /**
   * List the events on one timeline. Metabase has no endpoint of its own for these: the same
   * timeline read hydrates them on request, and `archived` chooses which of them come back.
   */
  async function events(
    id: number,
    params: TimelineEventsParams = {},
    options: RequestOptions = {},
  ): Promise<ListResult<TimelineEvent>> {
    const timeline = await transport.requestParsed(TimelineWithEvents, `/api/timeline/${id}`, {
      ...options,
      query: { include: "events", archived: params.archived },
    });
    return { data: timeline.events, total: null };
  }

  /** Create a timeline from a full timeline body. */
  async function create(
    params: TimelineCreateInput,
    options: RequestOptions = {},
  ): Promise<Timeline> {
    return transport.requestParsed(Timeline, "/api/timeline", {
      ...options,
      method: "POST",
      body: params,
    });
  }

  /**
   * Update a timeline by id, patching only the fields the body carries. Changing `archived`
   * cascades to every event on the timeline.
   */
  async function update(
    id: number,
    params: TimelineUpdateInput,
    options: RequestOptions = {},
  ): Promise<Timeline> {
    return transport.requestParsed(Timeline, `/api/timeline/${id}`, {
      ...options,
      method: "PUT",
      body: params,
    });
  }

  /**
   * Archive (soft-delete) a timeline and all its events by id. Metabase models this as an update,
   * not its own endpoint.
   */
  async function archive(id: number, options: RequestOptions = {}): Promise<Timeline> {
    return update(id, { archived: true }, options);
  }

  /** Permanently delete a timeline and all its events by id. The server answers with no body. */
  async function remove(id: number, options: RequestOptions = {}): Promise<void> {
    await transport.requestRaw(`/api/timeline/${id}`, {
      ...options,
      method: "DELETE",
      expectContentType: "binary",
    });
  }

  return { list, get, events, create, update, archive, delete: remove };
}
