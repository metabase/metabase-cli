import type { CommonContext } from "./context";
import type { FlagValues } from "./flag-values";

import {
  CSV_BYTE_ORDER_MARK_FEATURE,
  ExportFormat,
  PivotExportFormat,
} from "@metabase/client/domain/query";
import { ConfigError } from "@metabase/client/errors";
import type { CardExportParams } from "@metabase/client/resources/card";
import { featureAvailability } from "@metabase/client/version/features";

import { parseEnumFlag } from "./parse-enum";

const PIVOT_FORMATS = PivotExportFormat.options.join(" or ");
const PIVOT_FORMAT_VALUES = PivotExportFormat.options.map((format) => `\`${format}\``).join(" or ");

const exportOnlyFlags = {
  "format-rows": {
    type: "boolean",
    description:
      "Streamed exports only: format values as Metabase displays them, column settings included",
    default: false,
  },
  "pivot-results": {
    type: "boolean",
    description: `With \`--export-format\` ${PIVOT_FORMAT_VALUES}: lay a pivot table's rows out as the pivot, with its subtotals; refused when the server has pivoted exports turned off (the \`enable-pivoted-exports\` setting)`,
    default: false,
  },
  "csv-include-bom": {
    type: "boolean",
    description: `With \`--export-format csv\`: start the file with a UTF-8 byte order mark, so Excel reads it as UTF-8. Needs \`${CSV_BYTE_ORDER_MARK_FEATURE}\` (${featureAvailability(CSV_BYTE_ORDER_MARK_FEATURE)})`,
    default: false,
  },
} as const;

export const exportFlags = {
  "export-format": {
    type: "string",
    description: `Bypass the JSON envelope and stream the raw export: ${ExportFormat.options.join(" | ")}`,
  },
  ...exportOnlyFlags,
} as const;

export interface ExportRequest {
  format: ExportFormat;
  params: Omit<CardExportParams, "parameters">;
}

type ExportOnlyFlag = keyof typeof exportOnlyFlags;

function isExportOnlyFlag(flag: string): flag is ExportOnlyFlag {
  return flag in exportOnlyFlags;
}

const EXPORT_ONLY_FLAGS = Object.keys(exportOnlyFlags).filter(isExportOnlyFlag);

/**
 * The export the flags ask for, or `null` when `--export-format` is absent. An export-only flag
 * given without a format would be ignored silently, so it is refused.
 */
export function readExportRequest(args: FlagValues<typeof exportFlags>): ExportRequest | null {
  const raw = args["export-format"];
  if (raw === undefined || raw === "") {
    const stray = EXPORT_ONLY_FLAGS.find((flag) => args[flag]);
    if (stray !== undefined) {
      throw new ConfigError(`--${stray} requires --export-format`);
    }
    return null;
  }
  const format = parseEnumFlag(raw, ExportFormat, "--export-format");
  if (args["csv-include-bom"] && format !== "csv") {
    throw new ConfigError("--csv-include-bom requires --export-format csv");
  }
  if (args["pivot-results"] && !PivotExportFormat.safeParse(format).success) {
    throw new ConfigError(`--pivot-results requires --export-format ${PIVOT_FORMATS}`);
  }
  return {
    format,
    params: {
      format_rows: args["format-rows"],
      pivot_results: args["pivot-results"],
      csv_include_bom: args["csv-include-bom"],
    },
  };
}

/**
 * A streamed export is the server's bytes, so a flag that shapes the JSON output would be ignored
 * silently and is refused. `--json` and `--format` still pick the shape of an error report.
 */
export function assertStreamedOutput(ctx: CommonContext): void {
  if (ctx.full) {
    throw new ConfigError("--full cannot be combined with --export-format");
  }
  if (ctx.fields !== undefined) {
    throw new ConfigError("--fields cannot be combined with --export-format");
  }
  if (ctx.maxBytesGiven) {
    throw new ConfigError("--max-bytes cannot be combined with --export-format");
  }
  if (ctx.range.limit !== undefined) {
    throw new ConfigError("--limit cannot be combined with --export-format");
  }
}
