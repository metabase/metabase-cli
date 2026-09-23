import { z } from "zod";

// `test-mode` keeps the drivers off the release feed; `not-installed` is a build that cannot replace
// itself, such as `out/` in development or an AppImage extracted to a directory.
export const UpdatesOffReason = z.enum(["test-mode", "not-installed"]);
export type UpdatesOffReason = z.infer<typeof UpdatesOffReason>;

// A failed background check is logged and retried on the next one; a failed download is the
// user's to see, because they asked for it.
export const UpdateStep = z.enum(["check", "download"]);
export type UpdateStep = z.infer<typeof UpdateStep>;

const Version = z.string().min(1);

export const UpdateState = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("off"), reason: UpdatesOffReason }).strict(),
  z.object({ kind: z.literal("idle") }).strict(),
  z.object({ kind: z.literal("checking") }).strict(),
  z.object({ kind: z.literal("current"), version: Version }).strict(),
  z.object({ kind: z.literal("available"), version: Version }).strict(),
  z
    .object({
      kind: z.literal("downloading"),
      version: Version,
      percent: z.number().min(0).max(100),
    })
    .strict(),
  z.object({ kind: z.literal("ready"), version: Version }).strict(),
  z.object({ kind: z.literal("error"), step: UpdateStep, message: z.string() }).strict(),
]);
export type UpdateState = z.infer<typeof UpdateState>;
