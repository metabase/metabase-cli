import type { RewoundConversation } from "../../contracts/events";
import type { SessionSnapshot, TimelineItem } from "../../contracts/session";
import { checkpointRef } from "../git/checkpoints";

const BASELINE_SEQ = 0;

const REPLAY_PREFACE =
  "This conversation continues an earlier one in this same checkout. Here is that conversation up to the point the user returned to:";

const SPEAKERS = { user: "User", assistant: "Assistant" } as const;

export interface RewindPoint {
  readonly messageId: string;
  readonly kept: readonly TimelineItem[];
  readonly checkpointRef: string;
}

export function rewindPoint(snapshot: SessionSnapshot, turnId: string): RewindPoint | null {
  const items = snapshot.items;
  const cut = items.findIndex((item) => item.kind === "user" && item.turnId === turnId);
  const prompt = items[cut];
  if (prompt === undefined || prompt.kind !== "user") {
    return null;
  }
  const kept = items.slice(0, cut);
  const checkpoints = kept.filter((item) => item.kind === "checkpoint");
  const last = checkpoints[checkpoints.length - 1];
  return {
    messageId: prompt.messageId,
    kept,
    checkpointRef: last === undefined ? checkpointRef(snapshot.session.id, BASELINE_SEQ) : last.ref,
  };
}

// A provider that cannot cut its own conversation is handed what was said instead: the prompts and
// the replies, without the tool calls, which the checkout already reflects.
export function transcriptReplay(kept: readonly TimelineItem[]): string | null {
  const said: string[] = [];
  for (const item of kept) {
    if ((item.kind === "user" || item.kind === "assistant") && item.text.trim().length > 0) {
      said.push(`${SPEAKERS[item.kind]}:\n${item.text.trim()}`);
    }
  }
  return said.length === 0 ? null : [REPLAY_PREFACE, ...said].join("\n\n");
}

export function replayedConversation(kept: readonly TimelineItem[]): RewoundConversation {
  const replay = transcriptReplay(kept);
  return replay === null ? { kind: "fresh" } : { kind: "replayed", replay };
}
