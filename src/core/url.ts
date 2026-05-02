export function normalizeUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("URL must start with http:// or https://");
  }
  return trimmed;
}

export function originOnly(input: string): string {
  const parsed = new URL(input);
  parsed.username = "";
  parsed.password = "";
  return parsed.origin;
}
