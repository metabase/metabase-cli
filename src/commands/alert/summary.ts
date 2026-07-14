import type { Notification } from "../../domain/notification";

export function describeAlert(verb: string, alert: Notification): string {
  if (alert.payload === null) {
    return `${verb} alert ${alert.id}.`;
  }
  return `${verb} alert ${alert.id} on card ${alert.payload.card_id}.`;
}
