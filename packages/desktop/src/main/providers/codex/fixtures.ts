import { readFile } from "node:fs/promises";

import { parseJson } from "@metabase/client/json";
import { z } from "zod";

import { FRAME_MARK } from "./client";

const DIRECTION_MARKS = [
  { direction: "out", mark: FRAME_MARK.outbound },
  { direction: "in", mark: FRAME_MARK.inbound },
  { direction: "log", mark: FRAME_MARK.stderr },
] as const;

// What the provider log holds, split back into the direction each line travelled.
export const RecordedLine = z
  .object({ direction: z.enum(["out", "in", "log"]), line: z.string().min(1) })
  .strict();
export type RecordedLine = z.infer<typeof RecordedLine>;

export function recordedLine(entry: string): RecordedLine | null {
  for (const { direction, mark } of DIRECTION_MARKS) {
    if (entry.startsWith(mark)) {
      return { direction, line: entry.slice(mark.length) };
    }
  }
  return null;
}

export async function readRecording(path: string): Promise<readonly RecordedLine[]> {
  const text = await readFile(path, "utf8");
  const lines = text.split("\n").filter((line) => line.length > 0);
  return lines.map((line, index) =>
    parseJson(line, RecordedLine, { source: `${path}:${index + 1}` }),
  );
}
