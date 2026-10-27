import { describe, expect, it } from "vitest";

import type { ClassifiedChange, ContentFile } from "./ci-affected";
import type { CiEventBody } from "./ci-events";
import { type CoverageAssessment, assessCoverage, coverageStage } from "./ci-coverage";

const DAILY_ID = "7JwIkkAG-06-nsl4jzsaq";
const HOURLY_ID = "7XqqzlsonSq4KFyOvtrAm";
const LEGACY_ID = "LegacyLegacyLegacy001";
const DAILY_PATH = "transforms/daily.yaml";

function transform(entityId: string, name: string, sql: string): ContentFile {
  return {
    kind: "transform",
    entityId,
    name,
    logic: { source: { query: sql }, target: { name: "t" } },
  };
}

const NOTHING_TESTED: ReadonlySet<string> = new Set();

const DAILY = { entityId: DAILY_ID, name: "Daily" };
const HOURLY = { entityId: HOURLY_ID, name: "Hourly" };
const LEGACY = { entityId: LEGACY_ID, name: "Legacy" };

function assess(
  changes: ClassifiedChange[],
  tested: ReadonlySet<string> = NOTHING_TESTED,
  dailyNameAtHead = "Daily",
): CoverageAssessment {
  const transformsAtHead = new Map<string, string>([
    [DAILY_ID, dailyNameAtHead],
    [HOURLY_ID, "Hourly"],
    [LEGACY_ID, "Legacy"],
  ]);
  return assessCoverage({ changes, transformsAtHead, testedAtHead: tested });
}

describe("assessCoverage", () => {
  it("requires a test for a transform the change adds", () => {
    expect(
      assess([{ path: DAILY_PATH, base: null, head: transform(DAILY_ID, "Daily", "SELECT 1") }]),
    ).toEqual({
      untestedChanges: [{ entityId: DAILY_ID, name: "Daily", change: "new" }],
      untouchedUntested: [HOURLY, LEGACY],
    });
  });

  it("requires a test for a transform whose logic the change edits", () => {
    const change = {
      path: DAILY_PATH,
      base: transform(DAILY_ID, "Daily", "SELECT 1"),
      head: transform(DAILY_ID, "Daily", "SELECT 2"),
    };

    expect(assess([change])).toEqual({
      untestedChanges: [{ entityId: DAILY_ID, name: "Daily", change: "edited" }],
      untouchedUntested: [HOURLY, LEGACY],
    });
  });

  it("only lists a transform whose name changed, since what it computes did not", () => {
    const change = {
      path: DAILY_PATH,
      base: transform(DAILY_ID, "Daily", "SELECT 1"),
      head: transform(DAILY_ID, "Daily totals", "SELECT 1"),
    };

    expect(assess([change], NOTHING_TESTED, "Daily totals")).toEqual({
      untestedChanges: [],
      untouchedUntested: [{ entityId: DAILY_ID, name: "Daily totals" }, HOURLY, LEGACY],
    });
  });

  it("counts a transform a rename split into a deletion and an addition as unchanged", () => {
    const changes = [
      {
        path: "transforms/old-daily.yaml",
        base: transform(DAILY_ID, "Daily", "SELECT 1"),
        head: null,
      },
      { path: DAILY_PATH, base: null, head: transform(DAILY_ID, "Daily", "SELECT 1") },
    ];

    expect(assess(changes)).toEqual({
      untestedChanges: [],
      untouchedUntested: [DAILY, HOURLY, LEGACY],
    });
  });

  it("accepts a new transform that has a test", () => {
    expect(
      assess(
        [{ path: DAILY_PATH, base: null, head: transform(DAILY_ID, "Daily", "SELECT 1") }],
        new Set([DAILY_ID]),
      ),
    ).toEqual({
      untestedChanges: [],
      untouchedUntested: [HOURLY, LEGACY],
    });
  });

  it("accepts an edited transform that has a test", () => {
    const change = {
      path: DAILY_PATH,
      base: transform(DAILY_ID, "Daily", "SELECT 1"),
      head: transform(DAILY_ID, "Daily", "SELECT 2"),
    };

    expect(assess([change], new Set([DAILY_ID]))).toEqual({
      untestedChanges: [],
      untouchedUntested: [HOURLY, LEGACY],
    });
  });

  it("does not list a tested transform as untouched and untested", () => {
    expect(assess([], new Set([HOURLY_ID, LEGACY_ID]))).toEqual({
      untestedChanges: [],
      untouchedUntested: [DAILY],
    });
  });
});

async function reports(assessment: CoverageAssessment): Promise<CiEventBody[]> {
  const bodies: CiEventBody[] = [];
  await coverageStage(assessment).run((check) =>
    bodies.push({ type: "check.result", stage: "lint", ...check }),
  );
  return bodies;
}

describe("coverageStage", () => {
  it("fails each untested new or edited transform, then summarizes the untouched ones", async () => {
    expect(
      await reports({
        untestedChanges: [{ entityId: DAILY_ID, name: "Daily", change: "new" }],
        untouchedUntested: [
          { entityId: HOURLY_ID, name: "Hourly" },
          { entityId: LEGACY_ID, name: "Legacy" },
        ],
      }),
    ).toEqual([
      {
        type: "check.result",
        stage: "lint",
        check: { kind: "coverage", id: DAILY_ID, label: "Daily" },
        verdict: "failed",
        warnings: [],
        ms: 0,
        detail: {
          change: "new",
          message: "Daily is new in this change and has no transform tests",
        },
      },
      {
        type: "check.result",
        stage: "lint",
        check: {
          kind: "coverage",
          id: "untouched",
          label: "Transforms whose logic this change did not touch",
        },
        verdict: "passed",
        warnings: [
          {
            code: "no-tests-untouched",
            message:
              "2 transforms whose logic this change did not touch have no tests: Hourly, Legacy",
          },
        ],
        ms: 0,
        detail: {
          untested: [
            { entity_id: HOURLY_ID, name: "Hourly" },
            { entity_id: LEGACY_ID, name: "Legacy" },
          ],
        },
      },
    ]);
  });

  it("names a single untouched transform without tests", async () => {
    const bodies = await reports({
      untestedChanges: [],
      untouchedUntested: [{ entityId: LEGACY_ID, name: "Legacy" }],
    });

    expect(bodies.map((body) => (body.type === "check.result" ? body.warnings : null))).toEqual([
      [
        {
          code: "no-tests-untouched",
          message: "1 transform whose logic this change did not touch has no tests: Legacy",
        },
      ],
    ]);
  });

  it("passes with no warning when every transform is tested", async () => {
    expect(await reports({ untestedChanges: [], untouchedUntested: [] })).toEqual([
      {
        type: "check.result",
        stage: "lint",
        check: {
          kind: "coverage",
          id: "untouched",
          label: "Transforms whose logic this change did not touch",
        },
        verdict: "passed",
        warnings: [],
        ms: 0,
        detail: { untested: [] },
      },
    ]);
  });
});
