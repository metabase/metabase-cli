import { ConfigError } from "../core/errors";
import type { Format } from "./types";

export interface FormatInputs {
  json: boolean | undefined;
  format: string | undefined;
  isTty: boolean;
}

export function resolveFormat({ json, format, isTty }: FormatInputs): Format {
  const explicit = format !== undefined && format !== "auto" ? format : null;
  if (explicit !== null && explicit !== "json" && explicit !== "text") {
    throw new ConfigError(`invalid --format value: "${explicit}" (expected: auto, json, text)`);
  }
  if (json && explicit !== null && explicit !== "json") {
    throw new ConfigError(`--json conflicts with --format ${explicit}`);
  }
  if (json) {
    return "json";
  }
  if (explicit !== null) {
    return explicit;
  }
  return isTty ? "text" : "json";
}
