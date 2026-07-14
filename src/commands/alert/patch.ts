import { ConfigError } from "../../core/errors";
import type { Client } from "../../core/http/client";
import {
  CARD_PAYLOAD_TYPE,
  Notification,
  NotificationCardPayload,
  type NotificationCardPayloadPatch,
  type NotificationUpdateInput,
} from "../../domain/notification";

// /api/notification is shared with Metabase's internal system-event notifications, whose ids sit
// alongside the alerts'. Reading one through `mb alert` would be confusing, and sending one would
// fire an internal Metabase email, so every by-id verb loads the alert through here.
export async function fetchAlert(client: Client, id: number): Promise<Notification> {
  return assertCardAlert(await client.requestParsed(Notification, `/api/notification/${id}`));
}

export function assertCardAlert(notification: Notification): Notification {
  if (notification.payload_type !== CARD_PAYLOAD_TYPE) {
    throw new ConfigError(
      `notification ${notification.id} is a ${notification.payload_type}, not a question alert — \`mb alert\` manages card alerts only`,
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

export async function patchAlert(
  client: Client,
  id: number,
  patch: NotificationUpdateInput,
): Promise<Notification> {
  const current = await fetchAlert(client, id);
  return client.requestParsed(Notification, `/api/notification/${id}`, {
    method: "PUT",
    body: mergeAlertUpdate(current, patch),
  });
}
