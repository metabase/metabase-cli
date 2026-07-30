import { z } from "zod";

// How a cron expression was authored in the UI. Shared by notification subscriptions and
// transform-job schedules — both store the server's `ui_display_type`.
export const CronUiDisplayType = z.enum(["cron/raw", "cron/builder"]);
export type CronUiDisplayType = z.infer<typeof CronUiDisplayType>;
