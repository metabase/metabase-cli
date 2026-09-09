import type { ZodType } from "zod";

import type { Capabilities } from "@metabase/client/version/capabilities";

import type { WorktreePolicy } from "../core/worktree-scope";

export interface SkillPointer {
  skill: string;
  purpose: string;
}

export interface MetabaseAugment {
  examples: readonly string[];
  details: string | null;
  skills: readonly SkillPointer[];
  inputSchema: ZodType | null;
  outputSchema: ZodType | null;
  capabilities: Capabilities | null;
  worktree: WorktreePolicy;
}

const augments = new WeakMap<object, MetabaseAugment>();

export function setMetabaseAugment(cmd: object, augment: MetabaseAugment): void {
  augments.set(cmd, augment);
}

export function getMetabaseAugment(cmd: object): MetabaseAugment | null {
  return augments.get(cmd) ?? null;
}
