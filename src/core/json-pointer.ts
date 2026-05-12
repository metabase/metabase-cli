export function escapeJsonPointerSegment(key: PropertyKey): string {
  if (typeof key === "number") {
    return String(key);
  }
  const segment = typeof key === "symbol" ? key.toString() : key;
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}
