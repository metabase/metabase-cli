import { describe, expect, it } from "vitest";

import { ConfigError } from "@metabase/client/errors";

import { parseSlug } from "./slug";

const LONGEST_SLUG = "a".repeat(100);

describe("parseSlug", () => {
  it("returns a dash-cased slug of up to 100 characters", () => {
    expect([parseSlug("sales-overview-2"), parseSlug(LONGEST_SLUG)]).toEqual([
      "sales-overview-2",
      LONGEST_SLUG,
    ]);
  });

  it("refuses a slug that isn't dash-cased", () => {
    expect(() => parseSlug("Sales--overview")).toThrow(
      new ConfigError('slug "Sales--overview" must be dash-cased: a-z, 0-9 and single dashes'),
    );
  });

  it("refuses a slug over 100 characters", () => {
    const slug = `${LONGEST_SLUG}a`;

    expect(() => parseSlug(slug)).toThrow(
      new ConfigError(`slug "${slug}" must be at most 100 characters`),
    );
  });

  it.each(["repo-status", "generate"])("refuses the reserved slug %s", (slug) => {
    expect(() => parseSlug(slug)).toThrow(
      new ConfigError(`slug "${slug}" is reserved by Metabase`),
    );
  });
});
