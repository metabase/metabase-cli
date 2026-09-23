import { z } from "zod";

import { DiffFile } from "./changes";

// `paths` is the checkout as it stands: tracked files and new ones git does not ignore, less the
// ones deleted from disk. `changed` is what the session changed against its baseline.
export const SessionTree = z
  .object({
    paths: z.array(z.string().min(1)),
    truncated: z.boolean(),
    changed: z.array(DiffFile),
  })
  .strict();
export type SessionTree = z.infer<typeof SessionTree>;

const PreviewText = z
  .object({ kind: z.literal("text"), path: z.string().min(1), text: z.string() })
  .strict();

const PreviewBinary = z
  .object({
    kind: z.literal("binary"),
    path: z.string().min(1),
    bytes: z.number().int().nonnegative(),
  })
  .strict();

const PreviewTooLarge = z
  .object({
    kind: z.literal("too-large"),
    path: z.string().min(1),
    bytes: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
  })
  .strict();

// The file left the checkout between the tree's read and the preview's.
const PreviewGone = z.object({ kind: z.literal("gone"), path: z.string().min(1) }).strict();

export const FilePreview = z.discriminatedUnion("kind", [
  PreviewText,
  PreviewBinary,
  PreviewTooLarge,
  PreviewGone,
]);
export type FilePreview = z.infer<typeof FilePreview>;
