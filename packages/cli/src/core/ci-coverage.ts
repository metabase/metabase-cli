import { isDeepStrictEqual } from "node:util";

import type { ClassifiedChange, TransformLogic } from "./ci-affected";
import type { CiStage, CiWarning } from "./ci-events";

interface NamedTransform {
  entityId: string;
  name: string;
}

interface UntestedChange extends NamedTransform {
  change: "new" | "edited" | "lost-test";
}

interface CoverageInputs {
  changes: readonly ClassifiedChange[];
  transformsAtHead: ReadonlyMap<string, string>;
  testedAtHead: ReadonlySet<string>;
}

export interface CoverageAssessment {
  untestedChanges: UntestedChange[];
  untouchedUntested: NamedTransform[];
}

function byName(a: NamedTransform, b: NamedTransform): number {
  return a.name.localeCompare(b.name);
}

// A transform the change adds, or whose logic it edits, must have a test, and one that keeps existing
// must keep a test the change found it with; one it leaves alone, or changes only cosmetically, is
// only listed when it has none.
// A transform is new when no changed file held it at base, so a copy of an unchanged transform in a
// new file counts as new.
export function assessCoverage(inputs: CoverageInputs): CoverageAssessment {
  const logicAtBase = new Map<string, TransformLogic>();
  for (const { base } of inputs.changes) {
    if (base?.kind === "transform") {
      logicAtBase.set(base.entityId, base.logic);
    }
  }

  const changed = new Map<string, UntestedChange>();
  for (const { head } of inputs.changes) {
    if (head?.kind !== "transform" || inputs.testedAtHead.has(head.entityId)) {
      continue;
    }
    const before = logicAtBase.get(head.entityId);
    if (before === undefined) {
      changed.set(head.entityId, { entityId: head.entityId, name: head.name, change: "new" });
    } else if (!isDeepStrictEqual(before, head.logic)) {
      changed.set(head.entityId, { entityId: head.entityId, name: head.name, change: "edited" });
    }
  }

  // Every test file the transform had at base is in the diff, since none is left at head. Losing its
  // tests explains the gap better than an edit does, so it replaces one.
  for (const { base } of inputs.changes) {
    if (base?.kind !== "transform-test" || inputs.testedAtHead.has(base.transformId)) {
      continue;
    }
    const name = inputs.transformsAtHead.get(base.transformId);
    if (name !== undefined) {
      changed.set(base.transformId, { entityId: base.transformId, name, change: "lost-test" });
    }
  }

  const untouchedUntested: NamedTransform[] = [];
  for (const [entityId, name] of inputs.transformsAtHead) {
    if (!inputs.testedAtHead.has(entityId) && !changed.has(entityId)) {
      untouchedUntested.push({ entityId, name });
    }
  }
  return {
    untestedChanges: [...changed.values()].toSorted(byName),
    untouchedUntested: untouchedUntested.toSorted(byName),
  };
}

// The two lists hold every transform at head that no test file names, each once.
export function untestedTransforms(assessment: CoverageAssessment): Set<string> {
  return new Set(
    [...assessment.untestedChanges, ...assessment.untouchedUntested].map(
      (transform) => transform.entityId,
    ),
  );
}

const UNTOUCHED_CHECK_ID = "untouched";

function untouchedWarnings(untouched: readonly NamedTransform[]): CiWarning[] {
  if (untouched.length === 0) {
    return [];
  }
  const summary =
    untouched.length === 1
      ? "1 transform whose logic this change did not touch has"
      : `${untouched.length} transforms whose logic this change did not touch have`;
  const names = untouched.map((transform) => transform.name).join(", ");
  return [{ code: "no-tests-untouched", message: `${summary} no tests: ${names}` }];
}

function untestedMessage(transform: UntestedChange): string {
  if (transform.change === "lost-test") {
    return `${transform.name} lost its last transform test in this change`;
  }
  return `${transform.name} is ${transform.change} in this change and has no transform tests`;
}

export function coverageStage(assessment: CoverageAssessment): CiStage {
  return {
    name: "lint",
    run: async (report) => {
      for (const transform of assessment.untestedChanges) {
        report({
          check: { kind: "coverage", id: transform.entityId, label: transform.name },
          verdict: "failed",
          warnings: [],
          ms: 0,
          detail: {
            change: transform.change,
            message: untestedMessage(transform),
          },
        });
      }
      const untouched = assessment.untouchedUntested;
      report({
        check: {
          kind: "coverage",
          id: UNTOUCHED_CHECK_ID,
          label: "Transforms whose logic this change did not touch",
        },
        verdict: "passed",
        warnings: untouchedWarnings(untouched),
        ms: 0,
        detail: {
          untested: untouched.map((transform) => ({
            entity_id: transform.entityId,
            name: transform.name,
          })),
        },
      });
      return null;
    },
  };
}
