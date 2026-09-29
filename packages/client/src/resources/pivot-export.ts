import { z } from "zod";

import { type ExportFormat, PivotExportFormat } from "../domain/query";
import { ConfigError } from "../errors";
import type { RequestOptions, Transport } from "../http/transport";
import { PROBE_PATH } from "../version/probe";

// The session properties carry every setting the caller may read; the check needs only this one,
// which every signed-in user may read.
const PivotedExportsSetting = z.object({ "enable-pivoted-exports": z.boolean() });

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
  const setting = await transport.requestParsed(PivotedExportsSetting, PROBE_PATH, {
    ...options,
  });
  if (!setting["enable-pivoted-exports"]) {
    throw new ConfigError(
      "the server has pivoted exports turned off (the enable-pivoted-exports setting), so it would export the plain rows",
    );
  }
}
