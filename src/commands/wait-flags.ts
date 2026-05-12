import { DEFAULT_INTERVAL_MS, DEFAULT_TIMEOUT_MS } from "../runtime/poll";

import { parseId } from "./parse-id";

export const waitFlags = {
  wait: {
    type: "boolean",
    description: "Poll until the operation reaches a terminal state",
    default: false,
  },
  timeout: {
    type: "string",
    description: "Polling timeout in ms (used with --wait)",
    default: String(DEFAULT_TIMEOUT_MS),
  },
  interval: {
    type: "string",
    description: "Polling interval in ms (used with --wait)",
    default: String(DEFAULT_INTERVAL_MS),
  },
} as const;

export interface WaitArgs {
  wait?: boolean;
  timeout?: string;
  interval?: string;
}

export interface WaitSchedule {
  intervalMs: number;
  timeoutMs: number;
}

export interface WaitOptions {
  enabled: boolean;
  schedule: WaitSchedule;
}

export function parseWaitFlags(args: WaitArgs): WaitOptions {
  const interval = args.interval ?? String(DEFAULT_INTERVAL_MS);
  const timeout = args.timeout ?? String(DEFAULT_TIMEOUT_MS);
  return {
    enabled: args.wait === true,
    schedule: {
      intervalMs: parseId(interval, "interval"),
      timeoutMs: parseId(timeout, "timeout"),
    },
  };
}
