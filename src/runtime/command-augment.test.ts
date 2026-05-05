import { describe, expect, it } from "vitest";
import { z } from "zod";

import { getMetabaseAugment, setMetabaseAugment, type MetabaseAugment } from "./command-augment";

describe("getMetabaseAugment / setMetabaseAugment", () => {
  it("returns null for a command that has no augment recorded", () => {
    const cmd = {};
    expect(getMetabaseAugment(cmd)).toBeNull();
  });

  it("round-trips an augment through set/get on the same command object", () => {
    const cmd = {};
    const augment: MetabaseAugment = {
      examples: ["metabase card list"],
      outputSchema: z.object({ id: z.number() }),
    };
    setMetabaseAugment(cmd, augment);
    expect(getMetabaseAugment(cmd)).toBe(augment);
  });

  it("keys augments by reference identity, not structural equality", () => {
    const first = {};
    const second = {};
    const firstAugment: MetabaseAugment = { examples: ["a"], outputSchema: null };
    const secondAugment: MetabaseAugment = { examples: ["b"], outputSchema: null };
    setMetabaseAugment(first, firstAugment);
    setMetabaseAugment(second, secondAugment);
    expect(getMetabaseAugment(first)).toBe(firstAugment);
    expect(getMetabaseAugment(second)).toBe(secondAugment);
  });

  it("overwrites an existing augment when set is called twice on the same command", () => {
    const cmd = {};
    const initial: MetabaseAugment = { examples: ["before"], outputSchema: null };
    const replacement: MetabaseAugment = { examples: ["after"], outputSchema: null };
    setMetabaseAugment(cmd, initial);
    setMetabaseAugment(cmd, replacement);
    expect(getMetabaseAugment(cmd)).toBe(replacement);
  });

  it("accepts outputSchema=null as a valid stored augment", () => {
    const cmd = {};
    const augment: MetabaseAugment = { examples: [], outputSchema: null };
    setMetabaseAugment(cmd, augment);
    const recalled = getMetabaseAugment(cmd);
    expect(recalled).toEqual({ examples: [], outputSchema: null });
  });
});
