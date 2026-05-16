import type { ZodType } from "zod";

import type { Capabilities } from "./capabilities";

export interface MetabaseAugment {
  examples: readonly string[];
  outputSchema: ZodType | null;
  capabilities: Capabilities;
}

const augments = new WeakMap<object, MetabaseAugment>();

export function setMetabaseAugment(cmd: object, augment: MetabaseAugment): void {
  augments.set(cmd, augment);
}

export function getMetabaseAugment(cmd: object): MetabaseAugment | null {
  return augments.get(cmd) ?? null;
}
