import { z } from "zod";

import {
  PermissionMode,
  type ToolKind,
  type TurnOutcome,
  type TurnUsage,
} from "../../../contracts/events";

import { firstText, repoRelative, shorten } from "../text";

export const SYSTEM_MESSAGE = "system";
export const STREAM_MESSAGE = "stream_event";
export const ASSISTANT_MESSAGE = "assistant";
export const USER_MESSAGE = "user";
export const RESULT_MESSAGE = "result";

export const SDK_PERMISSION_MODES = {
  ask: "default",
  edits: "acceptEdits",
  "auto-review": "auto",
  bypass: "bypassPermissions",
} as const;

const ERROR_SEPARATOR = "; ";
const SUCCESS_RESULT = "success";
const INTERRUPTED_TERMINAL_REASONS: ReadonlySet<string> = new Set([
  "aborted_tools",
  "aborted_streaming",
]);

const TOOL_KINDS: Readonly<Record<string, ToolKind>> = {
  Bash: "command",
  Read: "read",
  Glob: "search",
  Grep: "search",
  Edit: "edit",
  Write: "edit",
  MultiEdit: "edit",
  NotebookEdit: "edit",
  WebFetch: "web",
  WebSearch: "web",
};
const UNKNOWN_TOOL_KIND: ToolKind = "other";

export const ClaudeMessage = z.object({ type: z.string().min(1) }).loose();
export type ClaudeMessage = z.infer<typeof ClaudeMessage>;

export const InitMessage = z
  .object({
    type: z.literal(SYSTEM_MESSAGE),
    subtype: z.literal("init"),
    session_id: z.string().min(1),
    model: z.string().min(1),
    permissionMode: z.string().min(1),
    slash_commands: z.array(z.string().min(1)),
  })
  .loose();
export type InitMessage = z.infer<typeof InitMessage>;

export const CompactBoundaryMessage = z
  .object({
    type: z.literal(SYSTEM_MESSAGE),
    subtype: z.literal("compact_boundary"),
    compact_metadata: z
      .object({ trigger: z.string().min(1), pre_tokens: z.number().int().nonnegative() })
      .loose(),
  })
  .loose();
export type CompactBoundaryMessage = z.infer<typeof CompactBoundaryMessage>;

export const StreamMessage = z
  .object({ type: z.literal(STREAM_MESSAGE), event: z.object({ type: z.string().min(1) }).loose() })
  .loose();

export const MessageStartEvent = z
  .object({
    type: z.literal("message_start"),
    message: z.object({ id: z.string().min(1) }).loose(),
  })
  .loose();

export const TextDeltaEvent = z
  .object({
    type: z.literal("content_block_delta"),
    delta: z.object({ type: z.literal("text_delta"), text: z.string() }).loose(),
  })
  .loose();

export const ThinkingDeltaEvent = z
  .object({
    type: z.literal("content_block_delta"),
    delta: z.object({ type: z.literal("thinking_delta"), thinking: z.string() }).loose(),
  })
  .loose();

const ContentBlock = z.object({ type: z.string().min(1) }).loose();

export const AssistantMessage = z
  .object({
    type: z.literal(ASSISTANT_MESSAGE),
    message: z.object({ id: z.string().min(1), content: z.array(ContentBlock) }).loose(),
  })
  .loose();

export const TextBlock = z.object({ type: z.literal("text"), text: z.string() }).loose();

export const ToolUseBlock = z
  .object({
    type: z.literal("tool_use"),
    id: z.string().min(1),
    name: z.string().min(1),
    input: z.json(),
  })
  .loose();
export type ToolUseBlock = z.infer<typeof ToolUseBlock>;

const ToolResultPart = z.object({ text: z.string() }).loose();

export const ToolResultBlock = z
  .object({
    type: z.literal("tool_result"),
    tool_use_id: z.string().min(1),
    content: z.union([z.string(), z.array(z.unknown())]).optional(),
    is_error: z.boolean().optional(),
  })
  .loose();
export type ToolResultBlock = z.infer<typeof ToolResultBlock>;

const PatchHunk = z
  .object({
    oldStart: z.number().int(),
    oldLines: z.number().int(),
    newStart: z.number().int(),
    newLines: z.number().int(),
    lines: z.array(z.string()),
  })
  .loose();

// Both fields are the edit tools'; a command tool reports its streams here instead and matches with
// neither present.
export const ToolUseResult = z
  .object({
    filePath: z.string().min(1).optional(),
    structuredPatch: z.array(PatchHunk).optional(),
  })
  .loose();

export const QuestionResult = z.object({ answers: z.record(z.string(), z.string()) }).loose();

export const UserToolMessage = z
  .object({
    type: z.literal(USER_MESSAGE),
    message: z.object({ content: z.array(ContentBlock) }).loose(),
    tool_use_result: z.unknown(),
  })
  .loose();

const ResultUsage = z
  .object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    cache_read_input_tokens: z.number().int().nonnegative(),
    cache_creation_input_tokens: z.number().int().nonnegative(),
  })
  .loose();

export const ResultMessage = z
  .object({
    type: z.literal(RESULT_MESSAGE),
    subtype: z.string().min(1),
    duration_ms: z.number().int().nonnegative(),
    result: z.string().optional(),
    errors: z.array(z.string()).optional(),
    terminal_reason: z.string().optional(),
    total_cost_usd: z.number().nonnegative().optional(),
    usage: ResultUsage.optional(),
  })
  .loose();
export type ResultMessage = z.infer<typeof ResultMessage>;

const SalientToolInput = z
  .object({
    file_path: z.string().optional(),
    command: z.string().optional(),
    pattern: z.string().optional(),
    url: z.string().optional(),
    query: z.string().optional(),
    notebook_path: z.string().optional(),
    description: z.string().optional(),
  })
  .loose();

export function appPermissionMode(sdkMode: string): PermissionMode | null {
  const match = PermissionMode.options.find((mode) => SDK_PERMISSION_MODES[mode] === sdkMode);
  return match ?? null;
}

export function toolKindOf(name: string): ToolKind {
  return TOOL_KINDS[name] ?? UNKNOWN_TOOL_KIND;
}

export function toolResultText(content: string | readonly unknown[] | undefined): string {
  if (content === undefined) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  return content
    .map((part) => {
      const text = ToolResultPart.safeParse(part);
      return text.success ? text.data.text : "";
    })
    .join("");
}

export function unifiedPatch(hunks: readonly z.infer<typeof PatchHunk>[]): string | null {
  if (hunks.length === 0) {
    return null;
  }
  return hunks
    .map((hunk) => {
      const header = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
      return [header, ...hunk.lines].join("\n");
    })
    .join("\n");
}

export function turnOutcome(result: ResultMessage): TurnOutcome {
  const reason = result.terminal_reason;
  if (reason !== undefined && INTERRUPTED_TERMINAL_REASONS.has(reason)) {
    return { kind: "interrupted" };
  }
  if (result.subtype === SUCCESS_RESULT) {
    return { kind: "completed" };
  }
  const errors = result.errors === undefined ? undefined : result.errors.join(ERROR_SEPARATOR);
  return { kind: "failed", message: firstText(result.result, errors) ?? result.subtype };
}

export function turnUsage(result: ResultMessage): TurnUsage | null {
  const usage = result.usage;
  if (usage === undefined) {
    return null;
  }
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens,
    cacheWriteTokens: usage.cache_creation_input_tokens,
    costUsd: result.total_cost_usd ?? null,
  };
}

export function toolLabel(toolName: string, input: unknown, cwd: string): string {
  const fields = SalientToolInput.safeParse(input);
  if (!fields.success) {
    return toolName;
  }
  const salient = firstText(
    fields.data.file_path,
    fields.data.command,
    fields.data.pattern,
    fields.data.url,
    fields.data.query,
    fields.data.notebook_path,
    fields.data.description,
  );
  if (salient === null) {
    return toolName;
  }
  return shorten(`${toolName} ${repoRelative(cwd, salient)}`);
}
