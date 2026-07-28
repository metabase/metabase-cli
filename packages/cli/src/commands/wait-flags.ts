import { DEFAULT_INTERVAL_MS, DEFAULT_TIMEOUT_MS } from "@metabase/client/poll";

import { interruptSignal } from "../runtime/interrupt";
import { parseId } from "./parse-id";

const waitScheduleFlags = {
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

export const waitFlags = {
  wait: {
    type: "boolean",
    description: "Poll until the operation reaches a terminal state",
    default: false,
  },
  ...waitScheduleFlags,
} as const;

// git-sync import/export/stash block by default — these are interactive content-sync
// operations where the terminal result is what the caller wants. The blocking default is
// the deliberate, documented exception to the fire-and-forget `waitFlags` default; both
// share `waitScheduleFlags` so timeout/interval can never drift between the two.
export const gitSyncWaitFlags = {
  wait: {
    type: "boolean",
    description:
      "Poll the resulting task until it reaches a terminal status (default: true; pass --no-wait to fire-and-forget)",
    default: true,
  },
  ...waitScheduleFlags,
} as const;

interface WaitScheduleArgs {
  timeout?: string;
  interval?: string;
}

interface WaitArgs extends WaitScheduleArgs {
  wait?: boolean;
}

// `signal` rides along with the interval and timeout so that every poll loop the CLI starts is
// interruptible by construction — a command that forgets it would hang on Ctrl-C.
export interface WaitSchedule {
  intervalMs: number;
  timeoutMs: number;
  signal: AbortSignal;
}

interface WaitOptions {
  enabled: boolean;
  schedule: WaitSchedule;
}

export function parseWaitSchedule(args: WaitScheduleArgs): WaitSchedule {
  const interval = args.interval ?? String(DEFAULT_INTERVAL_MS);
  const timeout = args.timeout ?? String(DEFAULT_TIMEOUT_MS);
  return {
    intervalMs: parseId(interval, "interval"),
    timeoutMs: parseId(timeout, "timeout"),
    signal: interruptSignal,
  };
}

export function parseWaitFlags(args: WaitArgs): WaitOptions {
  return { enabled: args.wait === true, schedule: parseWaitSchedule(args) };
}
