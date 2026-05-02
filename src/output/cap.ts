import type { ListEnvelope } from "./types";

export function capListEnvelope<T>(envelope: ListEnvelope<T>, maxBytes: number): ListEnvelope<T> {
  if (maxBytes <= 0) {
    return envelope;
  }
  const fullBytes = jsonByteLength(envelope);
  if (fullBytes <= maxBytes) {
    return envelope;
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
  return truncate(envelope, lo, fullBytes);
}

function truncate<T>(
  envelope: ListEnvelope<T>,
  count: number,
  originalBytes: number,
): ListEnvelope<T> {
  return {
    ...envelope,
    data: envelope.data.slice(0, count),
    returned: count,
    truncated: { reason: "max_bytes", bytes: originalBytes },
  };
}

function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}
