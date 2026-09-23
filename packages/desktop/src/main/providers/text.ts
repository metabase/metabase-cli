import { isAbsolute, relative } from "node:path";

const LABEL_MAX_CHARS = 72;
const ELLIPSIS = "…";

export function firstText(...candidates: readonly (string | null | undefined)[]): string | null {
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== null && candidate.length > 0) {
      return candidate;
    }
  }
  return null;
}

export function repoRelative(cwd: string, path: string): string {
  if (!isAbsolute(path)) {
    return path;
  }
  const inside = relative(cwd, path);
  if (inside.length === 0 || inside.startsWith("..")) {
    return path;
  }
  return inside;
}

export function shorten(text: string): string {
  const oneLine = text.replaceAll(/\s+/gu, " ").trim();
  if (oneLine.length <= LABEL_MAX_CHARS) {
    return oneLine;
  }
  return `${oneLine.slice(0, LABEL_MAX_CHARS)}${ELLIPSIS}`;
}
