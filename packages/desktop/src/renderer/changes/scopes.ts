import type { ChangeScope } from "../../contracts/changes";
import type { SessionSnapshot } from "../../contracts/session";

export interface TurnScope {
  readonly turnId: string;
  readonly label: string;
}

// Turns are numbered by the prompts the person sent, so "turn 2" is the second thing they asked
// for whether or not the first one changed a file.
function turnNumbers(snapshot: SessionSnapshot): ReadonlyMap<string, number> {
  const numbers = new Map<string, number>();
  for (const item of snapshot.items) {
    if (item.kind === "user" && !numbers.has(item.turnId)) {
      numbers.set(item.turnId, numbers.size + 1);
    }
  }
  return numbers;
}

export function turnScopes(snapshot: SessionSnapshot): readonly TurnScope[] {
  const numbers = turnNumbers(snapshot);
  const scopes: TurnScope[] = [];
  for (const item of snapshot.items) {
    const number = item.kind === "checkpoint" ? numbers.get(item.turnId) : undefined;
    if (item.kind === "checkpoint" && number !== undefined) {
      scopes.push({ turnId: item.turnId, label: `Turn ${number}` });
    }
  }
  return scopes;
}

export function restoreTarget(snapshot: SessionSnapshot, scope: ChangeScope): string {
  if (scope.kind === "all") {
    return "how it was when the session started";
  }
  const number = turnNumbers(snapshot).get(scope.turnId);
  return number === undefined ? "how it was before this turn" : `how it was before turn ${number}`;
}

// A turn an edit dropped has no diff left to ask main for.
export function liveScope(snapshot: SessionSnapshot, scope: ChangeScope): ChangeScope {
  if (scope.kind === "all") {
    return scope;
  }
  const held = turnScopes(snapshot).some((turn) => turn.turnId === scope.turnId);
  return held ? scope : { kind: "all" };
}
