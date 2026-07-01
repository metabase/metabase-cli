import type { ZodType } from "zod";

import type { Capabilities } from "./capabilities";

export interface SkillPointer {
  skill: string;
  purpose: string;
}

export interface MetabaseAugment {
  examples: readonly string[];
  details: string | null;
  skills: readonly SkillPointer[];
  outputSchema: ZodType | null;
  capabilities: Capabilities | null;
}

const augments = new WeakMap<object, MetabaseAugment>();

export function setMetabaseAugment(cmd: object, augment: MetabaseAugment): void {
  augments.set(cmd, augment);
}

export function getMetabaseAugment(cmd: object): MetabaseAugment | null {
  return augments.get(cmd) ?? null;
}
