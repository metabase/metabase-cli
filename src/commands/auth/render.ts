export const EMPTY_CELL = "—";

function pickProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || !(key in value)) {
    return undefined;
  }
  const inner: unknown = Reflect.get(value, key);
  return inner;
}

export function pickString(value: unknown, key: string): string | null {
  const inner = pickProperty(value, key);
  return typeof inner === "string" ? inner : null;
}

export function pickBoolean(value: unknown, key: string): boolean | null {
  const inner = pickProperty(value, key);
  return typeof inner === "boolean" ? inner : null;
}

export function renderUserName(value: unknown): string {
  return pickString(value, "name") ?? EMPTY_CELL;
}

export function renderUserRole(value: unknown): string {
  const isAdmin = pickBoolean(value, "isAdmin");
  if (isAdmin === null) {
    return EMPTY_CELL;
  }
  return isAdmin ? "Admin" : "User";
}

export function renderAuthMethod(value: unknown): string {
  if (value === "oauth") {
    return "OAuth";
  }
  if (value === "apiKey") {
    return "API key";
  }
  return EMPTY_CELL;
}

export function renderVersionTag(value: unknown): string {
  return pickString(value, "tag") ?? EMPTY_CELL;
}

export function renderTimestamp(value: unknown): string {
  return typeof value === "string" ? value : EMPTY_CELL;
}
