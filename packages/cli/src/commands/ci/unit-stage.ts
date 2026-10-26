import { performance } from "node:perf_hooks";

import type { MetabaseClient } from "@metabase/client/client";
import type { EidTranslateEntry } from "@metabase/client/domain/eid-translation";
import { InternalError } from "@metabase/client/errors";
import type { TransformTest, TransformTestRunResult } from "@metabase/client/domain/transform-test";

import type { CheckedTransform, CiStage } from "../../core/ci-events";
import { refusalVerdict, testRefusal, testVerdict } from "../../core/ci-unit";
import { interruptSignal } from "../../runtime/interrupt";

interface FoundTransform {
  kind: "found";
  id: number;
}

interface MissingTransform {
  kind: "not-found" | "invalid-entity-id";
}

type TransformLookup = FoundTransform | MissingTransform;

export interface UnitStagePort {
  lookUpTransforms: (entityIds: readonly string[]) => Promise<ReadonlyMap<string, TransformLookup>>;
  listTests: (transformId: number) => Promise<readonly TransformTest[]>;
  runTest: (testId: number) => Promise<TransformTestRunResult>;
  nowMs: () => number;
}

// One transform test is a single synchronous request; this bounds it, server work included.
const TEST_TIMEOUT_MS = 120_000;
const OK_STATUS = "ok";

const LOOKUP_KIND_BY_STATUS: ReadonlyMap<string, MissingTransform["kind"]> = new Map([
  ["not-found", "not-found"],
  ["invalid-format", "invalid-entity-id"],
]);

// The server answers every entity id it was asked about, as `ok` with an id, `not-found` or
// `invalid-format`; anything else is a contract it no longer keeps.
function transformLookup(entityId: string, entry: EidTranslateEntry | undefined): TransformLookup {
  if (entry?.status === OK_STATUS && entry.id !== undefined) {
    return { kind: "found", id: entry.id };
  }
  const kind = entry === undefined ? undefined : LOOKUP_KIND_BY_STATUS.get(entry.status);
  if (kind === undefined) {
    throw new InternalError(
      `eid translation answered ${entityId} with ${JSON.stringify(entry ?? null)}`,
    );
  }
  return { kind };
}

export function clientPort(client: MetabaseClient): UnitStagePort {
  return {
    lookUpTransforms: async (entityIds) => {
      const result = await client.eidTranslation.translate({
        entity_ids: { transform: [...entityIds] },
      });
      const lookups = new Map<string, TransformLookup>();
      for (const entityId of entityIds) {
        lookups.set(entityId, transformLookup(entityId, result.entity_ids[entityId]));
      }
      return lookups;
    },
    listTests: async (transformId) =>
      (await client.transformTest.list({ "transform-id": transformId })).data,
    runTest: (testId) =>
      client.transformTest.run(testId, { timeoutMs: TEST_TIMEOUT_MS, signal: interruptSignal }),
    nowMs: () => performance.now(),
  };
}

// For a transform with no test to run, `check.id` is its entity_id; otherwise it is the test's id.
const MISSING_TRANSFORM_DETAIL = {
  "not-found": {
    error_code: "ci.transform-not-on-instance",
    message:
      "the transform is in the branch but not on the Metabase instance; load the branch into it first",
  },
  "invalid-entity-id": {
    error_code: "ci.invalid-entity-id",
    message: "the transform's entity_id in the branch is not a valid entity id",
  },
} as const;

export function unitStage(checked: readonly CheckedTransform[], port: UnitStagePort): CiStage {
  return {
    name: "unit",
    run: async (report) => {
      const lookups = await port.lookUpTransforms(checked.map((transform) => transform.entity_id));
      for (const transform of checked) {
        const lookup = lookups.get(transform.entity_id);
        if (lookup === undefined) {
          throw new InternalError(`no lookup for transform ${transform.entity_id}`);
        }
        if (lookup.kind !== "found") {
          report({
            check: { kind: "transform-test", id: transform.entity_id, label: transform.name },
            verdict: "refused",
            warnings: [],
            ms: 0,
            detail: MISSING_TRANSFORM_DETAIL[lookup.kind],
          });
          continue;
        }
        const tests = await port.listTests(lookup.id);
        if (tests.length === 0) {
          report({
            check: { kind: "coverage", id: transform.entity_id, label: transform.name },
            verdict: "passed",
            warnings: [
              {
                code: "no-tests",
                message: `${transform.name} has no transform tests, so nothing checked it`,
              },
            ],
            ms: 0,
            detail: null,
          });
          continue;
        }
        for (const test of tests.toSorted((a, b) => a.id - b.id)) {
          const check = {
            kind: "transform-test" as const,
            id: String(test.id),
            label: `${transform.name}: ${test.name}`,
          };
          const started = port.nowMs();
          try {
            const result = await port.runTest(test.id);
            report({
              check,
              verdict: testVerdict(result),
              warnings: [],
              ms: port.nowMs() - started,
              detail: result,
            });
          } catch (error) {
            const refusal = testRefusal(error);
            if (refusal === null) {
              throw error;
            }
            report({
              check,
              verdict: refusalVerdict(refusal),
              warnings: [],
              ms: port.nowMs() - started,
              detail: refusal,
            });
          }
        }
      }
    },
  };
}
