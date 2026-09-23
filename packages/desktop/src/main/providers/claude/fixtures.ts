import { readFile } from "node:fs/promises";

import { parseJson } from "@metabase/client/json";
import { z } from "zod";

import { ClaudeMessage } from "./wire";

const RecordedMessage = z.object({ kind: z.literal("message"), message: ClaudeMessage }).strict();

// `toolUseID` is the SDK's own spelling; a recorded session has no live control channel, so the
// replay keys the request on it.
const RecordedPermission = z
  .object({
    kind: z.literal("permission"),
    toolName: z.string().min(1),
    input: z.unknown(),
    toolUseID: z.string().min(1),
    title: z.string().nullable(),
    suggestionCount: z.number().int().nonnegative(),
  })
  .strict();

export const RecordedFrame = z.discriminatedUnion("kind", [RecordedMessage, RecordedPermission]);
export type RecordedFrame = z.infer<typeof RecordedFrame>;

export async function readFrames(path: string): Promise<readonly RecordedFrame[]> {
  const text = await readFile(path, "utf8");
  const lines = text.split("\n").filter((line) => line.length > 0);
  return lines.map((line, index) =>
    parseJson(line, RecordedFrame, { source: `${path}:${index + 1}` }),
  );
}
