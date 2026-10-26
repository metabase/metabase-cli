import { isDeepStrictEqual } from "node:util";

import type { ClassifiedChange, TransformLogic } from "./ci-affected";
import type { CiStage, CiWarning } from "./ci-events";

interface NamedTransform {
  entityId: string;
  name: string;
}

interface UntestedChange extends NamedTransform {
  change: "new" | "edited";
}

export interface CoverageInputs {
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

// A transform the change adds, or whose logic it edits, must have a test; one it leaves alone, or
// changes only cosmetically, is only listed when it has none.
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
            message: `${transform.name} is ${transform.change} in this change and has no transform tests`,
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
    },
  };
}
