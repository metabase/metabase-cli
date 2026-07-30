import { z } from "zod";

import {
  CARD_PAYLOAD_TYPE,
  Notification,
  NotificationCardPayload,
  type NotificationCardPayloadPatch,
  type NotificationCreateInput,
  type NotificationUpdateInput,
} from "../domain/notification";
import { ConfigError } from "../errors";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";

// `GET /api/notification` answers a bare array rather than a `{ data, total }` envelope, so the
// count a caller reads off `ListResult` is the array's own length and the server reports none.
const NotificationApiList = z.array(Notification);

export interface NotificationListParams {
  card_id?: number | undefined;
  creator_id?: number | undefined;
  recipient_id?: number | undefined;
  include_inactive?: boolean | undefined;
}

// /api/notification is shared with Metabase's internal system-event notifications, whose ids sit
// alongside the question alerts'. Reading one as an alert would be confusing, and sending one would
// fire an internal Metabase email, so every by-id verb loads the notification through here.
export function assertCardAlert(notification: Notification): Notification {
  if (notification.payload_type !== CARD_PAYLOAD_TYPE) {
    throw new ConfigError(
      `notification ${notification.id} is a ${notification.payload_type}, not a question alert — this operation accepts card alerts only`,
    );
  }
  return notification;
}

// `PUT /api/notification/:id` is a spec-diff against the stored row, not a patch: a body whose
// `id` does not match the stored one makes Metabase delete the notification and insert a
// replacement under a fresh id, and the same holds for the nested `payload` row. So every update
// reads the current notification and merges the caller's patch over it, preserving both ids.
export function mergeAlertUpdate(
  current: Notification,
  patch: NotificationUpdateInput,
): Notification {
  return Notification.parse({
    ...current,
    ...patch,
    id: current.id,
    payload: patch.payload === undefined ? current.payload : mergePayload(current, patch.payload),
  });
}

// A card alert whose payload row was deleted server-side comes back with `payload: null`. It can
// still be deactivated, but there is nothing to merge a payload patch into.
function mergePayload(
  current: Notification,
  patch: NotificationCardPayloadPatch,
): NotificationCardPayload {
  if (current.payload === null) {
    throw new ConfigError(
      `alert ${current.id} has lost its card payload — it can be archived, but not patched`,
    );
  }
  return NotificationCardPayload.parse({ ...current.payload, ...patch });
}

// Every path parameter here is a numeric id, so no fragment needs `encodeURIComponent`.
export function notificationResource(transport: Transport) {
  /**
   * List question alerts, optionally narrowed by the card they watch, their creator, or a
   * recipient. `/api/notification` also serves Metabase's internal system-event notifications, so
   * the request pins the card payload type.
   */
  async function list(
    params: NotificationListParams = {},
    options: RequestOptions = {},
  ): Promise<ListResult<Notification>> {
    const data = await transport.requestParsed(NotificationApiList, "/api/notification", {
      ...options,
      query: {
        payload_type: CARD_PAYLOAD_TYPE,
        card_id: params.card_id,
        creator_id: params.creator_id,
        recipient_id: params.recipient_id,
        include_inactive: params.include_inactive,
      },
    });
    return { data, total: null };
  }

  /** Get one question alert by id, refusing an id that names a system-event notification. */
  async function get(id: number, options: RequestOptions = {}): Promise<Notification> {
    const notification = await transport.requestParsed(Notification, `/api/notification/${id}`, {
      ...options,
    });
    return assertCardAlert(notification);
  }

  /** Create a question alert — its card payload, schedules and handlers — from a full body. */
  async function create(
    params: NotificationCreateInput,
    options: RequestOptions = {},
  ): Promise<Notification> {
    return transport.requestParsed(Notification, "/api/notification", {
      ...options,
      method: "POST",
      body: params,
    });
  }

  /** Update a question alert by id, merging the patch over the stored notification. */
  async function update(
    id: number,
    params: NotificationUpdateInput,
    options: RequestOptions = {},
  ): Promise<Notification> {
    const current = await get(id, options);
    return transport.requestParsed(Notification, `/api/notification/${id}`, {
      ...options,
      method: "PUT",
      body: mergeAlertUpdate(current, params),
    });
  }

  /** Archive a question alert by id, stopping every delivery. Metabase models this as an update. */
  async function archive(id: number, options: RequestOptions = {}): Promise<Notification> {
    return update(id, { active: false }, options);
  }

  /**
   * Send a question alert now, off-schedule, to every handler on it. The server answers with no
   * body.
   */
  async function send(id: number, options: RequestOptions = {}): Promise<void> {
    await get(id, options);
    await transport.requestRaw(`/api/notification/${id}/send`, {
      ...options,
      method: "POST",
      expectContentType: "binary",
    });
  }

  return { list, get, create, update, archive, send };
}
