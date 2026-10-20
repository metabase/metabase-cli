import type { FeatureName } from "./features";

export interface PresentTrigger {
  readonly kind: "present";
}

export interface ValuesTrigger {
  readonly kind: "values";
  readonly values: readonly (string | null)[];
}

export interface NonEmptyTrigger {
  readonly kind: "nonEmpty";
}

export type GateTrigger = PresentTrigger | ValuesTrigger | NonEmptyTrigger;

// `needs`: the server must hold the feature to take the value. `supersededBy`: a server holding
// the feature reads the value as something else, so it must not hold it. `droppedBy`: a server
// holding the feature drops the value unread, which costs the caller nothing, so it is only noted.
export type GateEffect = "needs" | "supersededBy" | "droppedBy";

export interface InputGate {
  readonly feature: FeatureName;
  readonly effect: GateEffect;
  readonly when: GateTrigger;
}

/** Whether `value`, as a caller passes it for the gated field, is one the gate applies to. */
export function gateTriggered(gate: InputGate, value: unknown): boolean {
  const { when } = gate;
  switch (when.kind) {
    case "present": {
      return value !== undefined;
    }
    case "values": {
      return when.values.some((gated) => gated === value);
    }
    case "nonEmpty": {
      return Array.isArray(value) && value.length > 0;
    }
  }
}

export { inputGatesOf } from "./input-gate-registry";
