import { forkSession, getSessionMessages } from "@anthropic-ai/claude-agent-sdk";

import type { RewindInput, RewindOutcome } from "../adapter";

// Claude Code keeps the UUID the app gave each prompt, so the conversation is forked at the entry
// just before that prompt. A prompt that opened the conversation leaves nothing to keep.
export async function rewindClaudeSession(input: RewindInput): Promise<RewindOutcome> {
  const messages = await getSessionMessages(input.nativeSessionId, { dir: input.cwd });
  const index = messages.findIndex((message) => message.uuid === input.promptId);
  if (index === -1) {
    return {
      kind: "unsupported",
      reason: `Claude Code's conversation ${input.nativeSessionId} holds no prompt ${input.promptId}.`,
    };
  }
  const kept = messages[index - 1];
  if (kept === undefined) {
    return { kind: "fresh" };
  }
  const forked = await forkSession(input.nativeSessionId, {
    dir: input.cwd,
    upToMessageId: kept.uuid,
  });
  return { kind: "forked", nativeSessionId: forked.sessionId };
}
