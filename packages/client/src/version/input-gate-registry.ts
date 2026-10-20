import { z } from "zod";

import type { InputGate } from "./input-gates";

interface FieldGates {
  readonly gates: readonly InputGate[];
}

// A registry of the client's own keeps the gates out of the global one, which every embedder's
// `z.toJSONSchema` reads.
const inputGates = z.registry<FieldGates>();

// Answers `schema` itself rather than a clone, whose parent link would make `z.toJSONSchema` hoist
// its children into `$defs`.
export function gateInput<S extends z.core.$ZodType>(schema: S, ...gates: InputGate[]): S {
  inputGates.add(schema, { gates });
  return schema;
}

/** The gates recorded on an input property, `null` when every server takes all its values. */
export function inputGatesOf(schema: z.core.$ZodType): readonly InputGate[] | null {
  const recorded = inputGates.get(schema);
  return recorded === undefined ? null : recorded.gates;
}
