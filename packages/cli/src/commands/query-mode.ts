import type { FlagValues } from "./flag-values";

import { type ExportFormat, VisualizationSettings } from "@metabase/client/domain/query";
import { ConfigError } from "@metabase/client/errors";
import { parseJson } from "@metabase/client/json";
import type { DatasetExportParams } from "@metabase/client/resources/dataset";

import { type ExportRequest, exportFlags, readExportRequest } from "./export-flags";

export const queryModeFlags = {
  "dry-run": {
    type: "boolean",
    description:
      "Check the body and compile it on the server to native SQL without running it; prints {ok, errors, sql}",
  },
  compile: {
    type: "boolean",
    description: "Print the native query the server compiles the body to, instead of running it",
  },
  metadata: {
    type: "boolean",
    description:
      "Print the databases, tables, fields and snippets the body references, instead of running it",
  },
  pretty: {
    type: "boolean",
    description:
      "With --compile: format the native query for reading, as the server does by default; --no-pretty compiles to one line",
  },
  ...exportFlags,
  "visualization-settings": {
    type: "string",
    description:
      "With --export-format: JSON object of visualization settings; column settings shape --format-rows, pivot_table.column_split the --pivot-results layout",
  },
  "print-schema": {
    type: "boolean",
    description: "Emit the bundled MBQL 5 query JSON Schema and exit; no body required",
  },
} as const;

interface RunMode {
  kind: "run";
}

interface PrintSchemaMode {
  kind: "print-schema";
}

interface DryRunMode {
  kind: "dry-run";
}

interface CompileMode {
  kind: "compile";
  // Absent leaves the choice to the server, which prettifies.
  pretty: boolean | undefined;
}

interface MetadataMode {
  kind: "metadata";
}

interface ExportMode {
  kind: "export";
  format: ExportFormat;
  params: Omit<DatasetExportParams, "query">;
}

export type QueryMode =
  | RunMode
  | PrintSchemaMode
  | DryRunMode
  | CompileMode
  | MetadataMode
  | ExportMode;

interface SelectedMode {
  flag: string;
  mode: QueryMode;
}

type QueryModeArgs = FlagValues<typeof queryModeFlags>;

const COLUMN_SPLIT_KEY = "pivot_table.column_split";
const PIVOT_NEEDS_SPLIT = `--pivot-results requires --visualization-settings with ${COLUMN_SPLIT_KEY}`;

export function resolveQueryMode(args: QueryModeArgs): QueryMode {
  const exportRequest = readExportRequest(args);
  const visualizationSettings = readVisualizationSettings(args, exportRequest);
  const selected: SelectedMode[] = [];
  if (args["print-schema"] === true) {
    selected.push({ flag: "--print-schema", mode: { kind: "print-schema" } });
  }
  if (args["dry-run"] === true) {
    selected.push({ flag: "--dry-run", mode: { kind: "dry-run" } });
  }
  if (args.compile === true) {
    selected.push({ flag: "--compile", mode: { kind: "compile", pretty: args.pretty } });
  }
  if (args.metadata === true) {
    selected.push({ flag: "--metadata", mode: { kind: "metadata" } });
  }
  if (exportRequest !== null) {
    const params = { ...exportRequest.params, visualization_settings: visualizationSettings };
    selected.push({
      flag: "--export-format",
      mode: { kind: "export", format: exportRequest.format, params },
    });
  }
  const [first, ...rest] = selected;
  if (first === undefined) {
    assertPrettyLeftAlone(args, { kind: "run" });
    return { kind: "run" };
  }
  if (rest.length > 0) {
    const others = rest.map((entry) => entry.flag).join(", ");
    throw new ConfigError(`${first.flag} cannot be combined with ${others}`);
  }
  assertPrettyLeftAlone(args, first.mode);
  return first.mode;
}

function assertPrettyLeftAlone(args: QueryModeArgs, mode: QueryMode): void {
  if (args.pretty === undefined || mode.kind === "compile") {
    return;
  }
  const flag = args.pretty ? "--pretty" : "--no-pretty";
  throw new ConfigError(`${flag} requires --compile`);
}

// A pivoted layout comes from the settings' `pivot_table.column_split`; an ad-hoc query has no saved
// settings to fall back on, so `--pivot-results` without it has no pivot to lay the rows out in.
function readVisualizationSettings(
  args: QueryModeArgs,
  exportRequest: ExportRequest | null,
): VisualizationSettings | undefined {
  const raw = args["visualization-settings"];
  const given = raw !== undefined && raw !== "";
  if (exportRequest === null) {
    if (given) {
      throw new ConfigError("--visualization-settings requires --export-format");
    }
    return undefined;
  }
  if (!given) {
    if (exportRequest.params.pivot_results) {
      throw new ConfigError(PIVOT_NEEDS_SPLIT);
    }
    return undefined;
  }
  const settings = parseJson(raw, VisualizationSettings, { source: "--visualization-settings" });
  if (exportRequest.params.pivot_results && !hasColumnSplit(settings)) {
    throw new ConfigError(PIVOT_NEEDS_SPLIT);
  }
  return settings;
}

function hasColumnSplit(settings: VisualizationSettings): boolean {
  const split = settings[COLUMN_SPLIT_KEY];
  return typeof split === "object" && split !== null;
}
