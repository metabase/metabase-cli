import type { TurnOutcome } from "../../contracts/events";
import type { SessionSnapshot, TimelineItem } from "../../contracts/session";

import { assertNever } from "../../contracts/assert-never";

type ItemOf<Kind extends TimelineItem["kind"]> = Extract<TimelineItem, { kind: Kind }>;

export type ToolItem = ItemOf<"tool">;
export type TurnItem = ItemOf<"turn">;

export type ActivityStatus = "running" | "ok" | "error";

export interface UserRow {
  readonly kind: "user";
  readonly id: string;
  readonly item: ItemOf<"user">;
}

export interface AssistantRow {
  readonly kind: "assistant";
  readonly id: string;
  readonly item: ItemOf<"assistant">;
  readonly streaming: boolean;
}

export interface ReasoningRow {
  readonly kind: "reasoning";
  readonly id: string;
  readonly item: ItemOf<"reasoning">;
  readonly streaming: boolean;
}

export interface ActivityRow {
  readonly kind: "activity";
  readonly id: string;
  readonly turnId: string;
  readonly tools: readonly ToolItem[];
  readonly status: ActivityStatus;
  readonly awaiting: ReadonlySet<string>;
}

export interface RequestRow {
  readonly kind: "request";
  readonly id: string;
  readonly item: ItemOf<"request">;
}

export interface CheckpointRow {
  readonly kind: "checkpoint";
  readonly id: string;
  readonly item: ItemOf<"checkpoint">;
}

export type StoppedTurn = Exclude<TurnOutcome, { kind: "completed" }>;

export interface TurnRow {
  readonly kind: "turn";
  readonly id: string;
  readonly outcome: StoppedTurn;
}

export interface SyncRow {
  readonly kind: "sync";
  readonly id: string;
  readonly item: ItemOf<"sync">;
}

export interface NoticeRow {
  readonly kind: "notice";
  readonly id: string;
  readonly item: ItemOf<"notice">;
}

export interface TurnFold {
  readonly toolCalls: number;
  readonly filesChanged: number;
  readonly durationMs: number;
  readonly outcome: TurnOutcome;
}

export interface FoldRow {
  readonly kind: "fold";
  readonly id: string;
  readonly turnId: string;
  readonly fold: TurnFold;
}

export interface WorkingRow {
  readonly kind: "working";
  readonly id: string;
  readonly turnId: string;
  readonly startedAt: string;
  readonly label: string;
}

export type TimelineRow =
  | UserRow
  | AssistantRow
  | ReasoningRow
  | ActivityRow
  | RequestRow
  | CheckpointRow
  | TurnRow
  | SyncRow
  | NoticeRow
  | FoldRow
  | WorkingRow;

export type TimelineRowKind = TimelineRow["kind"];

export const WORKING_ROW_ID = "working";

export const WORKING_LABEL = "Working";

export const WAITING_LABEL = "Waiting for you";

interface SingleUnit {
  readonly kind: "single";
  readonly id: string;
  readonly item: TimelineItem;
}

interface ActivityUnit {
  readonly kind: "activity";
  readonly id: string;
  readonly turnId: string;
  readonly tools: readonly ToolItem[];
}

type TimelineUnit = SingleUnit | ActivityUnit;

interface OpenRun {
  readonly turnId: string;
  readonly tools: ToolItem[];
}

function groupUnits(items: readonly TimelineItem[]): readonly TimelineUnit[] {
  const units: TimelineUnit[] = [];
  let open: OpenRun | null = null;
  for (const item of items) {
    if (item.kind !== "tool") {
      open = null;
      units.push({ kind: "single", id: item.id, item });
      continue;
    }
    if (open !== null && open.turnId === item.turnId) {
      open.tools.push(item);
      continue;
    }
    const tools = [item];
    open = { turnId: item.turnId, tools };
    units.push({ kind: "activity", id: item.id, turnId: item.turnId, tools });
  }
  return units;
}

function activityStatus(tools: readonly ToolItem[]): ActivityStatus {
  if (tools.some((tool) => tool.state.kind === "running")) {
    return "running";
  }
  const failed = tools.some(
    (tool) => tool.state.kind === "finished" && tool.state.status === "error",
  );
  return failed ? "error" : "ok";
}

function unitTurn(unit: TimelineUnit): string | null {
  if (unit.kind === "activity") {
    return unit.turnId;
  }
  const item = unit.item;
  return item.kind === "sync" || item.kind === "notice" ? null : item.turnId;
}

// A failed run stays on screen; folding it would hide the one thing worth reading.
function foldable(unit: TimelineUnit): boolean {
  if (unit.kind === "activity") {
    return activityStatus(unit.tools) !== "error";
  }
  return unit.item.kind === "reasoning";
}

interface FoldPlan {
  readonly turn: TurnItem;
  readonly toolCalls: number;
  readonly files: ReadonlySet<string>;
}

function turnItems(items: readonly TimelineItem[]): ReadonlyMap<string, TurnItem> {
  const turns = new Map<string, TurnItem>();
  for (const item of items) {
    if (item.kind === "turn") {
      turns.set(item.turnId, item);
    }
  }
  return turns;
}

interface FoldInput {
  readonly units: readonly TimelineUnit[];
  readonly turns: ReadonlyMap<string, TurnItem>;
  readonly liveTurn: string | null;
  readonly expandedTurns: ReadonlySet<string>;
}

function foldPlans(input: FoldInput): ReadonlyMap<string, FoldPlan> {
  const plans = new Map<string, FoldPlan>();
  for (const unit of input.units) {
    const turnId = unitTurn(unit);
    if (turnId === null || turnId === input.liveTurn || input.expandedTurns.has(turnId)) {
      continue;
    }
    const turn = input.turns.get(turnId);
    if (turn === undefined || !foldable(unit)) {
      continue;
    }
    const running = plans.get(turnId);
    const tools = unit.kind === "activity" ? unit.tools : [];
    const files = new Set(running === undefined ? [] : running.files);
    for (const tool of tools) {
      for (const path of tool.files) {
        files.add(path);
      }
    }
    const before = running === undefined ? 0 : running.toolCalls;
    plans.set(turnId, { turn, toolCalls: before + tools.length, files });
  }
  return plans;
}

function streamingId(snapshot: SessionSnapshot): string | null {
  const activity = snapshot.session.activity;
  if (activity.kind !== "running") {
    return null;
  }
  const last = snapshot.items.at(-1);
  if (last === undefined || (last.kind !== "assistant" && last.kind !== "reasoning")) {
    return null;
  }
  return last.turnId === activity.turnId ? last.id : null;
}

// A call the agent has asked permission for has not started its work, so it reads as waiting on
// the user rather than as running.
function awaitingCalls(snapshot: SessionSnapshot): ReadonlySet<string> {
  const awaiting = new Set<string>();
  for (const item of snapshot.items) {
    if (item.kind === "request" && item.resolution === null && item.callId !== null) {
      awaiting.add(item.callId);
    }
  }
  return awaiting;
}

function workingLabel(snapshot: SessionSnapshot, turnId: string): string {
  const asking = snapshot.items.some(
    (item) => item.kind === "request" && item.turnId === turnId && item.resolution === null,
  );
  if (asking) {
    return WAITING_LABEL;
  }
  for (let index = snapshot.items.length - 1; index >= 0; index -= 1) {
    const item = snapshot.items[index];
    if (item === undefined || item.kind !== "tool" || item.turnId !== turnId) {
      continue;
    }
    if (item.state.kind === "running" || item.state.status === "ok") {
      return item.label;
    }
    return WORKING_LABEL;
  }
  return WORKING_LABEL;
}

export interface TimelineView {
  readonly expandedTurns: ReadonlySet<string>;
}

function singleRow(item: TimelineItem, streaming: string | null): TimelineRow | null {
  switch (item.kind) {
    case "user": {
      return { kind: "user", id: item.id, item };
    }
    case "assistant": {
      return { kind: "assistant", id: item.id, item, streaming: streaming === item.id };
    }
    case "reasoning": {
      return { kind: "reasoning", id: item.id, item, streaming: streaming === item.id };
    }
    case "request": {
      return { kind: "request", id: item.id, item };
    }
    case "checkpoint": {
      return { kind: "checkpoint", id: item.id, item };
    }
    case "turn": {
      if (item.outcome.kind === "completed") {
        return null;
      }
      return { kind: "turn", id: item.id, outcome: item.outcome };
    }
    case "sync": {
      return { kind: "sync", id: item.id, item };
    }
    case "notice": {
      return { kind: "notice", id: item.id, item };
    }
    case "tool": {
      return null;
    }
    default: {
      return assertNever(item);
    }
  }
}

function foldRow(turnId: string, plan: FoldPlan, anchorId: string): FoldRow {
  return {
    kind: "fold",
    id: `fold:${anchorId}`,
    turnId,
    fold: {
      toolCalls: plan.toolCalls,
      filesChanged: plan.files.size,
      durationMs: plan.turn.durationMs,
      outcome: plan.turn.outcome,
    },
  };
}

export function buildRows(snapshot: SessionSnapshot, view: TimelineView): readonly TimelineRow[] {
  const units = groupUnits(snapshot.items);
  const activity = snapshot.session.activity;
  const liveTurn = activity.kind === "running" ? activity.turnId : null;
  const plans = foldPlans({
    units,
    turns: turnItems(snapshot.items),
    liveTurn,
    expandedTurns: view.expandedTurns,
  });
  const streaming = streamingId(snapshot);
  const awaiting = awaitingCalls(snapshot);

  const rows: TimelineRow[] = [];
  const folded = new Set<string>();
  for (const unit of units) {
    const turnId = unitTurn(unit);
    const plan = turnId === null ? undefined : plans.get(turnId);
    if (turnId !== null && plan !== undefined && foldable(unit)) {
      if (!folded.has(turnId)) {
        folded.add(turnId);
        rows.push(foldRow(turnId, plan, unit.id));
      }
      continue;
    }
    if (unit.kind === "activity") {
      rows.push({
        kind: "activity",
        id: unit.id,
        turnId: unit.turnId,
        tools: unit.tools,
        status: activityStatus(unit.tools),
        awaiting,
      });
      continue;
    }
    const row = singleRow(unit.item, streaming);
    if (row !== null) {
      rows.push(row);
    }
  }

  if (activity.kind === "running") {
    rows.push({
      kind: "working",
      id: WORKING_ROW_ID,
      turnId: activity.turnId,
      startedAt: activity.startedAt,
      label: workingLabel(snapshot, activity.turnId),
    });
  }
  return rows;
}
