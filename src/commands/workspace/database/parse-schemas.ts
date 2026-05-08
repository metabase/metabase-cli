import { ConfigError } from "../../../core/errors";
import type { WorkspaceInputNamespace } from "../../../domain/workspace";
import { parseCsv } from "../../../runtime/csv";

export function parseSchemasCsv(raw: string): WorkspaceInputNamespace[] {
  const parts = parseCsv(raw);
  if (parts.length === 0) {
    throw new ConfigError("--schemas must contain at least one schema name");
  }
  return parts.map((schema) => ({ schema }));
}
