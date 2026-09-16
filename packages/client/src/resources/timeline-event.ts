import {
  TimelineEvent,
  type TimelineEventCreateInput,
  type TimelineEventUpdateInput,
} from "../domain/timeline";
import type { RequestOptions, Transport } from "../http/transport";

export function timelineEventResource(transport: Transport) {
  /** Get one timeline event by id. */
  async function get(id: number, options: RequestOptions = {}): Promise<TimelineEvent> {
    await transport.require("timelineEvent.get");
    return transport.requestParsed(TimelineEvent, `/api/timeline-event/${id}`, { ...options });
  }

  /** Create a timeline event on an existing timeline. */
  async function create(
    params: TimelineEventCreateInput,
    options: RequestOptions = {},
  ): Promise<TimelineEvent> {
    await transport.require("timelineEvent.create");
    return transport.requestParsed(TimelineEvent, "/api/timeline-event", {
      ...options,
      method: "POST",
      body: params,
    });
  }

  /**
   * Update a timeline event by id, patching only the fields the body carries. `timeline_id` moves
   * the event to another timeline.
   */
  async function update(
    id: number,
    params: TimelineEventUpdateInput,
    options: RequestOptions = {},
  ): Promise<TimelineEvent> {
    await transport.require("timelineEvent.update");
    return transport.requestParsed(TimelineEvent, `/api/timeline-event/${id}`, {
      ...options,
      method: "PUT",
      body: params,
    });
  }

  /**
   * Archive (soft-delete) a timeline event by id. Metabase models this as an update, not its own
   * endpoint.
   */
  async function archive(id: number, options: RequestOptions = {}): Promise<TimelineEvent> {
    await transport.require("timelineEvent.archive");
    return update(id, { archived: true }, options);
  }

  /** Permanently delete a timeline event by id. The server answers with no body. */
  async function remove(id: number, options: RequestOptions = {}): Promise<void> {
    await transport.require("timelineEvent.delete");
    await transport.requestRaw(`/api/timeline-event/${id}`, {
      ...options,
      method: "DELETE",
      expectContentType: "binary",
    });
  }

  return { get, create, update, archive, delete: remove };
}
