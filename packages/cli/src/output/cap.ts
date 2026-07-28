import type { ListEnvelope } from "./types";

// How much of a list the byte cap can carry. `count` is the number of leading rows that fit —
// zero when not even one does — and `fullBytes` is what the untruncated envelope measured, so a
// caller can report the size of the answer it could not show.
export interface CapFit {
  count: number;
  fullBytes: number;
  cut: boolean;
}

export function fitWithinCap<T>(envelope: ListEnvelope<T>, maxBytes: number): CapFit {
  const fullBytes = jsonByteLength(envelope);
  if (maxBytes <= 0 || fullBytes <= maxBytes) {
    return { count: envelope.data.length, fullBytes, cut: false };
  }

  let lo = 0;
  let hi = envelope.data.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (jsonByteLength(truncate(envelope, mid, fullBytes)) <= maxBytes) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return { count: lo, fullBytes, cut: true };
}

export function capListEnvelope<T>(envelope: ListEnvelope<T>, maxBytes: number): ListEnvelope<T> {
  const fit = fitWithinCap(envelope, maxBytes);
  // A cut that drops no row is not a cut: an empty window is already the smallest answer this
  // list can give, so marking it truncated would claim rows the walk never found.
  if (!fit.cut || envelope.data.length === 0) {
    return envelope;
  }
  return truncate(envelope, fit.count, fit.fullBytes);
}

// Dropping rows here is what makes the cap resumable: `next_offset` is recomputed against the
// rows that survive, so the caller can ask for the remainder instead of losing it. A cut that
// keeps no row has no resumption point to recompute — `offset + 0` is the offset the caller just
// sent, and an agent following it would ask the same question forever — so it reports the rows
// that remain without one. Reaching them takes a wider cap or a narrower selection.
function truncate<T>(
  envelope: ListEnvelope<T>,
  count: number,
  originalBytes: number,
): ListEnvelope<T> {
  return {
    ...envelope,
    data: envelope.data.slice(0, count),
    returned: count,
    has_more: true,
    next_offset: count === 0 ? null : envelope.offset + count,
    truncated: { reason: "max_bytes", bytes: originalBytes },
  };
}

function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}
