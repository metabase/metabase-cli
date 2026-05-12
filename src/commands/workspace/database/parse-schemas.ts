import { ConfigError } from "../../../core/errors";
import { parseCsv } from "../../../runtime/csv";

export function parseSchemasCsv(raw: string): string[] {
  const parts = parseCsv(raw);
  if (parts.length === 0) {
    throw new ConfigError("--schemas must contain at least one schema name");
  }
  return parts;
}
