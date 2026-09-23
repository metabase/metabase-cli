import { assertNever } from "../../contracts/assert-never";

import type { TurnFold } from "./rows";

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

export function durationLabel(milliseconds: number): string {
  const seconds = Math.round(milliseconds / MS_PER_SECOND);
  if (seconds < SECONDS_PER_MINUTE) {
    return `${String(seconds)} s`;
  }
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  const rest = seconds % SECONDS_PER_MINUTE;
  return `${String(minutes)} min ${String(rest)} s`;
}

function countLabel(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

export function foldLabel(fold: TurnFold): string {
  const duration = durationLabel(fold.durationMs);
  switch (fold.outcome.kind) {
    case "interrupted": {
      return `Stopped after ${duration}`;
    }
    case "failed": {
      return `Failed after ${duration}`;
    }
    case "completed": {
      const clauses: string[] = [];
      if (fold.toolCalls > 0) {
        clauses.push(countLabel(fold.toolCalls, "tool call", "tool calls"));
      }
      if (fold.filesChanged > 0) {
        clauses.push(countLabel(fold.filesChanged, "file changed", "files changed"));
      }
      clauses.push(duration);
      return clauses.join(", ");
    }
    default: {
      return assertNever(fold.outcome);
    }
  }
}

export function changeLabel(added: number, removed: number): string {
  return `+${String(added)} −${String(removed)}`;
}

export function filesLabel(count: number): string {
  return count === 0 ? "no files changed" : countLabel(count, "file changed", "files changed");
}
