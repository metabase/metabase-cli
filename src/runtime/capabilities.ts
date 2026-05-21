import { z } from "zod";

export const Edition = z.enum(["oss", "ee"]);
export type Edition = z.infer<typeof Edition>;

export const Capabilities = z.object({
  minVersion: z.number(),
  edition: Edition,
  tokenFeature: z.string().optional(),
});
export type Capabilities = z.infer<typeof Capabilities>;

export const BASELINE_CAPABILITIES: Capabilities = Object.freeze({
  minVersion: 58,
  edition: "oss",
});
