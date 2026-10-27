import { describe, expect, it } from "vitest";

import type { ClassifiedChange, ContentFile } from "./ci-affected";
import type { CiEventBody } from "./ci-events";
import {
  type CoverageAssessment,
  assessCoverage,
  coverageStage,
  untestedTransforms,
} from "./ci-coverage";

const DAILY_ID = "7JwIkkAG-06-nsl4jzsaq";
const HOURLY_ID = "7XqqzlsonSq4KFyOvtrAm";
const LEGACY_ID = "LegacyLegacyLegacy001";
const ZETA_ID = "ZetaZetaZetaZetaZet01";
const DAILY_PATH = "transforms/daily.yaml";

function transform(entityId: string, name: string, sql: string): ContentFile {
  const logic = { source: { query: sql }, target: { name: "t" } };
  return {
    kind: "transform",
    entityId,
    name,
    logic: { yaml12: logic, yaml11: logic },
    testable: true,
  };
}

function pythonTransform(entityId: string, name: string, body: string): ContentFile {
  const logic = { source: { type: "python", body }, target: { name: "t" } };
  return {
    kind: "transform",
    entityId,
    name,
    logic: { yaml12: logic, yaml11: logic },
    testable: false,
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
  return assessCoverage({
    changes,
    transformsAtHead,
    testedAtHead: tested,
    untestableAtHead: NOTHING_TESTED,
  });
}

function assessPython(changes: ClassifiedChange[]): CoverageAssessment {
  const transformsAtHead = new Map<string, string>([
    [DAILY_ID, "Daily"],
    [HOURLY_ID, "Hourly"],
  ]);
  return assessCoverage({
    changes,
    transformsAtHead,
    testedAtHead: new Set([HOURLY_ID]),
    untestableAtHead: new Set([DAILY_ID]),
  });
}

describe("assessCoverage", () => {
  it("requires a test for a transform the change adds", () => {
    expect(
      assess([{ path: DAILY_PATH, base: null, head: transform(DAILY_ID, "Daily", "SELECT 1") }]),
    ).toEqual({
      untestedChanges: [{ entityId: DAILY_ID, name: "Daily", change: "new" }],
      untestableChanges: [],
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
      untestableChanges: [],
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
      untestableChanges: [],
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
      untestableChanges: [],
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
      untestableChanges: [],
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
      untestableChanges: [],
      untouchedUntested: [HOURLY, LEGACY],
    });
  });

  it("lists untested transforms by name, whatever order they were found in", () => {
    const changes = [
      {
        path: "transforms/legacy.yaml",
        base: null,
        head: transform(LEGACY_ID, "Legacy", "SELECT 1"),
      },
      { path: DAILY_PATH, base: null, head: transform(DAILY_ID, "Daily", "SELECT 1") },
    ];
    const transformsAtHead = new Map([
      [LEGACY_ID, "Legacy"],
      [DAILY_ID, "Daily"],
      [ZETA_ID, "Zeta"],
      [HOURLY_ID, "Hourly"],
    ]);

    expect(
      assessCoverage({
        changes,
        transformsAtHead,
        testedAtHead: NOTHING_TESTED,
        untestableAtHead: NOTHING_TESTED,
      }),
    ).toEqual({
      untestedChanges: [
        { ...DAILY, change: "new" },
        { ...LEGACY, change: "new" },
      ],
      untestableChanges: [],
      untouchedUntested: [HOURLY, { entityId: ZETA_ID, name: "Zeta" }],
    });
  });

  it("does not list a tested transform as untouched and untested", () => {
    expect(assess([], new Set([HOURLY_ID, LEGACY_ID]))).toEqual({
      untestedChanges: [],
      untestableChanges: [],
      untouchedUntested: [DAILY],
    });
  });
});

describe("assessCoverage on a transform Metabase cannot test", () => {
  it("lists a new Python transform without a test instead of requiring one", () => {
    expect(
      assessPython([
        { path: DAILY_PATH, base: null, head: pythonTransform(DAILY_ID, "Daily", "print(1)") },
      ]),
    ).toEqual({ untestedChanges: [], untestableChanges: [DAILY], untouchedUntested: [] });
  });

  it("lists a Python transform whose logic the change edits instead of requiring a test", () => {
    const change = {
      path: DAILY_PATH,
      base: pythonTransform(DAILY_ID, "Daily", "print(1)"),
      head: pythonTransform(DAILY_ID, "Daily", "print(2)"),
    };

    expect(assessPython([change])).toEqual({
      untestedChanges: [],
      untestableChanges: [DAILY],
      untouchedUntested: [],
    });
  });

  it("does not fail a Python transform whose last test the change removes", () => {
    const changes = [
      {
        path: "transforms/daily/test.yaml",
        base: { kind: "transform-test" as const, transformId: DAILY_ID },
        head: null,
      },
    ];

    expect(assessPython(changes)).toEqual({
      untestedChanges: [],
      untestableChanges: [DAILY],
      untouchedUntested: [],
    });
  });

  it("still requires a test for a new query transform beside it", () => {
    const changes = [
      { path: DAILY_PATH, base: null, head: pythonTransform(DAILY_ID, "Daily", "print(1)") },
      {
        path: "transforms/legacy.yaml",
        base: null,
        head: transform(LEGACY_ID, "Legacy", "SELECT 1"),
      },
    ];
    const transformsAtHead = new Map([
      [DAILY_ID, "Daily"],
      [LEGACY_ID, "Legacy"],
    ]);

    expect(
      assessCoverage({
        changes,
        transformsAtHead,
        testedAtHead: NOTHING_TESTED,
        untestableAtHead: new Set([DAILY_ID]),
      }),
    ).toEqual({
      untestedChanges: [{ ...LEGACY, change: "new" }],
      untestableChanges: [DAILY],
      untouchedUntested: [],
    });
  });
});

describe("untestedTransforms", () => {
  it("names every untested transform, changed or not", () => {
    expect(
      untestedTransforms({
        untestedChanges: [{ entityId: DAILY_ID, name: "Daily", change: "edited" }],
        untestableChanges: [],
        untouchedUntested: [{ entityId: LEGACY_ID, name: "Legacy" }],
      }),
    ).toEqual(new Set([DAILY_ID, LEGACY_ID]));
  });

  it("names a changed transform Metabase cannot test", () => {
    expect(
      untestedTransforms({
        untestedChanges: [],
        untestableChanges: [{ entityId: HOURLY_ID, name: "Hourly" }],
        untouchedUntested: [],
      }),
    ).toEqual(new Set([HOURLY_ID]));
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
  it("fails an untested new transform, then summarizes the untouched ones", async () => {
    expect(
      await reports({
        untestedChanges: [{ entityId: DAILY_ID, name: "Daily", change: "new" }],
        untestableChanges: [],
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

  it("says a transform lost its last test when the change removed it", async () => {
    const bodies = await reports({
      untestedChanges: [{ entityId: DAILY_ID, name: "Daily", change: "lost-test" }],
      untestableChanges: [],
      untouchedUntested: [],
    });

    expect(bodies[0]).toEqual({
      type: "check.result",
      stage: "lint",
      check: { kind: "coverage", id: DAILY_ID, label: "Daily" },
      verdict: "failed",
      warnings: [],
      ms: 0,
      detail: { change: "lost-test", message: "Daily lost its last transform test in this change" },
    });
  });

  it("warns about changed transforms Metabase cannot test, without failing them", async () => {
    const bodies = await reports({
      untestedChanges: [],
      untestableChanges: [
        { entityId: DAILY_ID, name: "Daily" },
        { entityId: HOURLY_ID, name: "Hourly" },
      ],
      untouchedUntested: [],
    });

    expect(bodies[0]).toEqual({
      type: "check.result",
      stage: "lint",
      check: {
        kind: "coverage",
        id: "untestable",
        label: "Transforms that cannot have transform tests",
      },
      verdict: "passed",
      warnings: [
        {
          code: "untestable-transform",
          message:
            "Daily, Hourly cannot have transform tests (Python transforms), so coverage does not require one",
        },
      ],
      ms: 0,
      detail: {
        untestable: [
          { entity_id: DAILY_ID, name: "Daily" },
          { entity_id: HOURLY_ID, name: "Hourly" },
        ],
      },
    });
  });

  it("names a single untouched transform without tests", async () => {
    const bodies = await reports({
      untestedChanges: [],
      untestableChanges: [],
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
    expect(
      await reports({ untestedChanges: [], untestableChanges: [], untouchedUntested: [] }),
    ).toEqual([
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
