import type { ParsedArgs } from "citty";

import { DataSensitivityStatus } from "@metabase/client/domain/data-sensitivity";
import { DEFAULT_TIMEOUT_MS } from "@metabase/client/poll";

import { parseEnumCsv } from "../../runtime/csv";
import { parseId } from "../parse-id";

export const scanFlags = {
  status: {
    type: "string",
    description: `Keep only fields with these statuses, comma separated: ${DataSensitivityStatus.options.join(" | ")} (text default: every field with a changed label or semantic type; JSON default: all)`,
  },
  timeout: {
    type: "string",
    description: "HTTP timeout in ms for the single synchronous scan request",
    // One synchronous request covers the whole scan, so its budget is the one a polled wait gets,
    // not the transport's per-request default.
    default: String(DEFAULT_TIMEOUT_MS),
  },
} as const;

type ScanArgs = ParsedArgs<typeof scanFlags>;

interface ScanOptions {
  statuses: DataSensitivityStatus[] | null;
  timeoutMs: number;
}

export function parseScanFlags(args: ScanArgs): ScanOptions {
  return {
    statuses: parseEnumCsv(args.status, DataSensitivityStatus, "--status") ?? null,
    timeoutMs: parseId(args.timeout, "timeout"),
  };
}
