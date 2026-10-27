import { performance } from "node:perf_hooks";

import type { MetabaseClient } from "@metabase/client/client";
import type { EidTranslateEntry } from "@metabase/client/domain/eid-translation";
import { InternalError } from "@metabase/client/errors";
import type { TransformTest, TransformTestRunResult } from "@metabase/client/domain/transform-test";

import type { CheckedTransform, CheckOutcome, CiStage, StageStop } from "../../core/ci-events";
import {
  type CiRefusal,
  type TransformRequest,
  type UnitFailure,
  INVALID_ENTITY_ID,
  lookupStop,
  NO_TESTS_ON_INSTANCE,
  testVerdict,
  TRANSFORM_NOT_ON_INSTANCE,
  transformFailure,
} from "../../core/ci-unit";
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
  readTransform: (transformId: number) => Promise<void>;
  listTests: (transformId: number) => Promise<readonly TransformTest[]>;
  runTest: (testId: number) => Promise<TransformTestRunResult>;
  nowMs: () => number;
}

// One transform test is a single synchronous request; this bounds how long the CLI waits for it.
const TEST_TIMEOUT_MS = 120_000;
const OK_STATUS = "ok";

const LOOKUP_KIND_BY_STATUS: ReadonlyMap<string, MissingTransform["kind"]> = new Map([
  ["not-found", "not-found"],
  ["invalid-format", "invalid-entity-id"],
]);

// The server answers every entity id it was asked about, as `ok` with an id, `not-found` or
// `invalid-format`; anything else breaks its contract.
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
      const result = await client.eidTranslation.translate(
        { entity_ids: { transform: [...entityIds] } },
        { signal: interruptSignal },
      );
      const lookups = new Map<string, TransformLookup>();
      for (const entityId of entityIds) {
        lookups.set(entityId, transformLookup(entityId, result.entity_ids[entityId]));
      }
      return lookups;
    },
    readTransform: async (transformId) => {
      await client.transform.get(transformId, { signal: interruptSignal });
    },
    listTests: async (transformId) => {
      const tests = await client.transformTest.list(
        { "transform-id": transformId },
        { signal: interruptSignal },
      );
      return tests.data;
    },
    runTest: (testId) =>
      client.transformTest.run(testId, { timeoutMs: TEST_TIMEOUT_MS, signal: interruptSignal }),
    nowMs: () => performance.now(),
  };
}

// For a check on a whole transform, `check.id` is its entity_id; for a test run, the test's id.
const MISSING_TRANSFORM_DETAIL: Record<MissingTransform["kind"], CiRefusal> = {
  "not-found": TRANSFORM_NOT_ON_INSTANCE,
  "invalid-entity-id": INVALID_ENTITY_ID,
};

interface Settled<T> {
  kind: "settled";
  value: T;
}

// A failure the stage cannot report, a bug or an interrupt, is rethrown.
async function attempt<T>(
  request: TransformRequest,
  call: () => Promise<T>,
): Promise<Settled<T> | UnitFailure> {
  try {
    return { kind: "settled", value: await call() };
  } catch (error) {
    const failure = transformFailure(error, request);
    if (failure === null) {
      throw error;
    }
    return failure;
  }
}

type Report = (check: CheckOutcome) => void;

// Reports a failure that costs one check, and answers the stop of one that ends the stage.
function reportFailure(
  failure: UnitFailure,
  check: CheckOutcome["check"],
  ms: number,
  report: Report,
): StageStop | null {
  if (failure.kind === "stop") {
    return failure.stop;
  }
  report({ check, verdict: failure.verdict, warnings: [], ms, detail: failure.detail });
  return null;
}

async function checkTransform(
  transform: CheckedTransform,
  transformId: number,
  untestedInBranch: boolean,
  port: UnitStagePort,
  report: Report,
): Promise<StageStop | null> {
  const transformCheck = {
    kind: "transform-test" as const,
    id: transform.entity_id,
    label: transform.name,
  };
  const started = port.nowMs();
  // The test list leaves out the tests the CI identity cannot read, so the transform is read first:
  // once that succeeds, an empty list means the transform has no tests, rather than hidden ones.
  const read = await attempt("read", () => port.readTransform(transformId));
  if (read.kind !== "settled") {
    return reportFailure(read, transformCheck, port.nowMs() - started, report);
  }
  const tests = await attempt("list", () => port.listTests(transformId));
  if (tests.kind !== "settled") {
    return reportFailure(tests, transformCheck, port.nowMs() - started, report);
  }
  // A transform the branch has no test for is the coverage check's to report.
  if (tests.value.length === 0 && !untestedInBranch) {
    report({
      check: transformCheck,
      verdict: "refused",
      warnings: [],
      ms: port.nowMs() - started,
      detail: NO_TESTS_ON_INSTANCE,
    });
    return null;
  }
  for (const test of tests.value.toSorted((a, b) => a.id - b.id)) {
    const check = {
      kind: "transform-test" as const,
      id: String(test.id),
      label: `${transform.name}: ${test.name}`,
    };
    const runStarted = port.nowMs();
    const run = await attempt("run", () => port.runTest(test.id));
    const ms = port.nowMs() - runStarted;
    if (run.kind === "settled") {
      report({ check, verdict: testVerdict(run.value), warnings: [], ms, detail: run.value });
      continue;
    }
    const stop = reportFailure(run, check, ms, report);
    if (stop !== null) {
      return stop;
    }
  }
  return null;
}

// The stage connects only when it runs, so the lint stage reports before a server is asked for.
export function unitStage(
  checked: readonly CheckedTransform[],
  untestedInBranch: ReadonlySet<string>,
  connect: () => Promise<UnitStagePort>,
): CiStage {
  return {
    name: "unit",
    run: async (report) => {
      const port = await connect();
      let lookups: ReadonlyMap<string, TransformLookup>;
      try {
        lookups = await port.lookUpTransforms(checked.map((transform) => transform.entity_id));
      } catch (error) {
        const stop = lookupStop(error);
        if (stop === null) {
          throw error;
        }
        return stop;
      }
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
        const untested = untestedInBranch.has(transform.entity_id);
        const stop = await checkTransform(transform, lookup.id, untested, port, report);
        if (stop !== null) {
          return stop;
        }
      }
      return null;
    },
  };
}
