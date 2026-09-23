import { z } from "zod";

import { assertNever } from "../../../contracts/assert-never";
import type { ToolKind, ToolStatus } from "../../../contracts/events";

import { FileUpdateChange, type PlanStep } from "./protocol";
import { repoRelative, shorten } from "../text";

const MORE_CHANGES_SUFFIX = " and ";
const FILE_CHANGE_LABEL = "Edit";
const PLAN_LABEL = "Plan";
const PATCH_SEPARATOR = "\n";
const PLAN_DONE_SUFFIX = " done";
const NO_OUTPUT = "";

const ItemStatus = z.enum(["inProgress", "completed", "failed", "declined"]);
type ItemStatus = z.infer<typeof ItemStatus>;

const ThreadItem = z.object({ type: z.string().min(1), id: z.string().min(1) }).loose();

const StatusItem = z.object({ status: ItemStatus }).loose();

const AgentMessageItem = z
  .object({ type: z.literal("agentMessage"), id: z.string().min(1), text: z.string() })
  .loose();

const ReasoningItem = z
  .object({
    type: z.literal("reasoning"),
    id: z.string().min(1),
    content: z.array(z.string()).nullish(),
    summary: z.array(z.string()).nullish(),
  })
  .loose();

const CommandExecutionItem = z
  .object({
    type: z.literal("commandExecution"),
    id: z.string().min(1),
    command: z.string(),
    status: ItemStatus,
    aggregatedOutput: z.string().nullish(),
  })
  .loose();

const FileChangeItem = z
  .object({
    type: z.literal("fileChange"),
    id: z.string().min(1),
    status: ItemStatus,
    changes: z.array(FileUpdateChange),
  })
  .loose();

const McpToolCallItem = z
  .object({
    type: z.literal("mcpToolCall"),
    id: z.string().min(1),
    server: z.string().min(1),
    tool: z.string().min(1),
    status: ItemStatus,
  })
  .loose();

const DynamicToolCallItem = z
  .object({
    type: z.literal("dynamicToolCall"),
    id: z.string().min(1),
    tool: z.string().min(1),
    status: ItemStatus,
  })
  .loose();

const WebSearchItem = z
  .object({ type: z.literal("webSearch"), id: z.string().min(1), query: z.string() })
  .loose();

const PlanItem = z
  .object({ type: z.literal("plan"), id: z.string().min(1), text: z.string() })
  .loose();

const ContextCompactionItem = z
  .object({ type: z.literal("contextCompaction"), id: z.string().min(1) })
  .loose();

export function changedPaths(changes: readonly FileUpdateChange[], cwd: string): string[] {
  return changes.map((change) => repoRelative(cwd, change.path));
}

export function changesPatch(changes: readonly FileUpdateChange[], cwd: string): string | null {
  if (changes.length === 0) {
    return null;
  }
  return changes
    .map((change) => `${repoRelative(cwd, change.path)}\n${change.diff}`)
    .join(PATCH_SEPARATOR);
}

function changeLabel(changes: readonly FileUpdateChange[], cwd: string): string {
  const [first] = changes;
  if (first === undefined) {
    return FILE_CHANGE_LABEL;
  }
  const path = repoRelative(cwd, first.path);
  if (changes.length === 1) {
    return shorten(path);
  }
  return shorten(`${path}${MORE_CHANGES_SUFFIX}${changes.length - 1} more`);
}

export interface ToolRow {
  readonly callId: string;
  readonly tool: ToolKind;
  readonly label: string;
}

// An assistant message, its reasoning and a compaction are carried by their own events and open
// no row.
export function toolRowOf(item: unknown, cwd: string): ToolRow | null {
  const base = ThreadItem.safeParse(item);
  if (!base.success) {
    return null;
  }
  switch (base.data.type) {
    case "commandExecution": {
      const parsed = CommandExecutionItem.safeParse(item);
      return parsed.success
        ? { callId: parsed.data.id, tool: "command", label: shorten(parsed.data.command) }
        : null;
    }
    case "fileChange": {
      const parsed = FileChangeItem.safeParse(item);
      return parsed.success
        ? { callId: parsed.data.id, tool: "edit", label: changeLabel(parsed.data.changes, cwd) }
        : null;
    }
    case "webSearch": {
      const parsed = WebSearchItem.safeParse(item);
      return parsed.success
        ? { callId: parsed.data.id, tool: "web", label: shorten(parsed.data.query) }
        : null;
    }
    case "mcpToolCall": {
      const parsed = McpToolCallItem.safeParse(item);
      return parsed.success
        ? {
            callId: parsed.data.id,
            tool: "other",
            label: shorten(`${parsed.data.server} ${parsed.data.tool}`),
          }
        : null;
    }
    case "dynamicToolCall": {
      const parsed = DynamicToolCallItem.safeParse(item);
      return parsed.success
        ? { callId: parsed.data.id, tool: "other", label: shorten(parsed.data.tool) }
        : null;
    }
    case "plan": {
      const parsed = PlanItem.safeParse(item);
      return parsed.success ? { callId: parsed.data.id, tool: "other", label: PLAN_LABEL } : null;
    }
    default: {
      return null;
    }
  }
}

function toolStatusOf(status: ItemStatus): ToolStatus {
  switch (status) {
    case "completed": {
      return "ok";
    }
    case "failed":
    case "declined":
    case "inProgress": {
      return "error";
    }
    default: {
      return assertNever(status);
    }
  }
}

export interface ToolOutcome {
  readonly status: ToolStatus;
  readonly output: string;
  readonly files: string[];
  readonly patch: string | null;
}

function statusOutcome(item: unknown): ToolOutcome | null {
  const parsed = StatusItem.safeParse(item);
  if (!parsed.success) {
    return null;
  }
  return { status: toolStatusOf(parsed.data.status), output: NO_OUTPUT, files: [], patch: null };
}

export function toolOutcomeOf(item: unknown, cwd: string): ToolOutcome | null {
  const base = ThreadItem.safeParse(item);
  if (!base.success) {
    return null;
  }
  switch (base.data.type) {
    case "commandExecution": {
      const parsed = CommandExecutionItem.safeParse(item);
      if (!parsed.success) {
        return null;
      }
      const output = parsed.data.aggregatedOutput;
      return {
        status: toolStatusOf(parsed.data.status),
        output: output === null || output === undefined ? NO_OUTPUT : output,
        files: [],
        patch: null,
      };
    }
    case "fileChange": {
      const parsed = FileChangeItem.safeParse(item);
      if (!parsed.success) {
        return null;
      }
      return {
        status: toolStatusOf(parsed.data.status),
        output: NO_OUTPUT,
        files: changedPaths(parsed.data.changes, cwd),
        patch: changesPatch(parsed.data.changes, cwd),
      };
    }
    case "webSearch": {
      const parsed = WebSearchItem.safeParse(item);
      return parsed.success ? { status: "ok", output: NO_OUTPUT, files: [], patch: null } : null;
    }
    case "mcpToolCall":
    case "dynamicToolCall": {
      return statusOutcome(item);
    }
    case "plan": {
      const parsed = PlanItem.safeParse(item);
      return parsed.success
        ? { status: "ok", output: parsed.data.text, files: [], patch: null }
        : null;
    }
    default: {
      return null;
    }
  }
}

export interface AssistantChunk {
  readonly messageId: string;
  readonly text: string;
  readonly reasoning: boolean;
}

export function assistantChunkOf(item: unknown): AssistantChunk | null {
  const message = AgentMessageItem.safeParse(item);
  if (message.success) {
    return { messageId: message.data.id, text: message.data.text, reasoning: false };
  }
  const reasoning = ReasoningItem.safeParse(item);
  if (!reasoning.success) {
    return null;
  }
  const parts = reasoning.data.content ?? reasoning.data.summary;
  if (parts === null || parts === undefined) {
    return null;
  }
  return { messageId: reasoning.data.id, text: parts.join(""), reasoning: true };
}

export function compactionItemId(item: unknown): string | null {
  const parsed = ContextCompactionItem.safeParse(item);
  return parsed.success ? parsed.data.id : null;
}

export function planLabel(plan: readonly PlanStep[]): string | null {
  const running = plan.find((step) => step.status === "inProgress");
  if (running !== undefined) {
    return shorten(running.step);
  }
  if (plan.length === 0) {
    return null;
  }
  const done = plan.filter((step) => step.status === "completed").length;
  return `${done}/${plan.length}${PLAN_DONE_SUFFIX}`;
}

export function planItemId(item: unknown): string | null {
  const parsed = PlanItem.safeParse(item);
  return parsed.success ? parsed.data.id : null;
}
