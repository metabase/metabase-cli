import { z } from "zod";

import { type ExportFormat, PivotExportFormat } from "../domain/query";
import { SessionProperties } from "../domain/session-properties";
import { ConfigError } from "../errors";
import type { RequestOptions, Transport } from "../http/transport";

// The session properties carry every setting the caller may read; the check needs only this one,
// which every signed-in user may read. They are read as a probe, so the export's own features and a
// refusal's explanation that follow need no request of their own.
const PivotedExportsProperty = SessionProperties.extend({ "enable-pivoted-exports": z.boolean() });

/**
 * Refuse a pivoted export the server would answer with plain rows: a JSON export keeps only the
 * ungrouped rows, and an admin can turn pivoted CSV and XLSX exports off.
 */
export async function assertPivotedExport(
  transport: Transport,
  format: ExportFormat,
  options: RequestOptions,
): Promise<void> {
  if (!PivotExportFormat.safeParse(format).success) {
    throw new ConfigError(
      `a ${format} export cannot be pivoted; only ${PivotExportFormat.options.join(" and ")} can`,
    );
  }
  const properties = await transport.probe(PivotedExportsProperty, options);
  if (!properties["enable-pivoted-exports"]) {
    throw new ConfigError(
      "the server has pivoted exports turned off (the enable-pivoted-exports setting), so it would export the plain rows",
    );
  }
}
