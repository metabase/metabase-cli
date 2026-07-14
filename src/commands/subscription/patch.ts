import type { Client } from "../../core/http/client";
import { Pulse, type PulseUpdateInput } from "../../domain/pulse";

// `PUT /api/pulse/:id` applies the server's schema defaults to keys the body omits, and both
// `archived` and `skip_if_empty` default to false. A patch that leaves them out therefore
// un-archives the subscription and clears skip_if_empty behind the caller's back. Every update
// carries both forward from the stored pulse unless the caller sets them explicitly. The
// remaining fields (`name`, `cards`, `channels`, `collection_id`, `parameters`) are optional
// server-side and survive an omission untouched.
export function mergeSubscriptionUpdate(current: Pulse, patch: PulseUpdateInput): PulseUpdateInput {
  return {
    ...patch,
    archived: patch.archived ?? current.archived,
    skip_if_empty: patch.skip_if_empty ?? current.skip_if_empty,
  };
}

export async function patchSubscription(
  client: Client,
  id: number,
  patch: PulseUpdateInput,
): Promise<Pulse> {
  const current = await client.requestParsed(Pulse, `/api/pulse/${id}`);
  return client.requestParsed(Pulse, `/api/pulse/${id}`, {
    method: "PUT",
    body: mergeSubscriptionUpdate(current, patch),
  });
}
