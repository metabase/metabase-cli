import type { ZodType } from "zod";

import type { CapabilitySummary } from "@metabase/client/version/capability-summary";
import type { FeatureName } from "@metabase/client/version/features";
import type { MethodKey } from "@metabase/client/version/requirements";

export interface SkillPointer {
  skill: string;
  purpose: string;
}

export interface CommandRequirements {
  methods: readonly MethodKey[];
  features: readonly FeatureName[];
}

export interface MetabaseAugment {
  examples: readonly string[];
  details: string | null;
  skills: readonly SkillPointer[];
  inputSchema: ZodType | null;
  outputSchema: ZodType | null;
  requires: CommandRequirements | null;
  capabilities: CapabilitySummary | null;
}

const augments = new WeakMap<object, MetabaseAugment>();

export function setMetabaseAugment(cmd: object, augment: MetabaseAugment): void {
  augments.set(cmd, augment);
}

export function getMetabaseAugment(cmd: object): MetabaseAugment | null {
  return augments.get(cmd) ?? null;
}
