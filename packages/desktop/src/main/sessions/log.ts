import { appendFile, readFile } from "node:fs/promises";

import { isFileNotFoundError } from "@metabase/client/errors";
import { parseJsonResult } from "@metabase/client/json";

import { SessionEvent } from "../../contracts/events";
import { SessionLogError } from "../../contracts/projector";

export const EVENTS_FILE_NAME = "events.jsonl";

const LINE_SEPARATOR = "\n";
const FIRST_LINE_NUMBER = 1;

// A line the app cannot read is a hole in the session's history, so the load stops on it and names
// where it is rather than skipping it and showing a session that is quietly missing turns.
export async function readSessionLog(path: string): Promise<SessionEvent[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return [];
    }
    throw error;
  }
  const events: SessionEvent[] = [];
  let lineNumber = FIRST_LINE_NUMBER;
  for (const line of text.split(LINE_SEPARATOR)) {
    if (line.trim().length > 0) {
      const parsed = parseJsonResult(line, SessionEvent, { source: `${path}:${lineNumber}` });
      if (!parsed.ok) {
        throw new SessionLogError(parsed.error.message);
      }
      events.push(parsed.value);
    }
    lineNumber += 1;
  }
  return events;
}

export async function appendSessionLog(
  path: string,
  events: readonly SessionEvent[],
): Promise<void> {
  if (events.length === 0) {
    return;
  }
  const lines = events.map((event) => `${JSON.stringify(event)}${LINE_SEPARATOR}`).join("");
  await appendFile(path, lines, "utf8");
}
