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
// the feature reads the value as something else, so it must not hold it.
export type GateEffect = "needs" | "supersededBy";

export interface InputGate {
  readonly feature: FeatureName;
  readonly effect: GateEffect;
  readonly when: GateTrigger;
}

export { inputGatesOf } from "./input-gate-registry";
