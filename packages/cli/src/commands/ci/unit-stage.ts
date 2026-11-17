import { performance } from "node:perf_hooks";

import type { MetabaseClient } from "@metabase/client/client";
import { DATA_TEST_TYPES, type DataTestType } from "@metabase/client/domain/data-test";
import type { TransformTestRunResult } from "@metabase/client/domain/transform-test";

import type { CheckOutcome, CiStage, StageStop } from "../../core/ci-events";
import {
  connectStop,
  isUnsupportedTestType,
  testFailure,
  testVerdict,
  type TestRequest,
} from "../../core/ci-unit";
import type { AnyTest } from "../../output/views/data-test";
import { interruptSignal } from "../../runtime/interrupt";

export type InstanceTest = Pick<AnyTest, "id" | "name">;

export interface UnitStagePort {
  listTests: (type: DataTestType) => Promise<readonly InstanceTest[]>;
  runTest: (type: DataTestType, testId: number) => Promise<TransformTestRunResult>;
  nowMs: () => number;
}

// One test run is a single synchronous request; this bounds how long the CLI waits for it.
const TEST_TIMEOUT_MS = 120_000;

export function clientPort(client: MetabaseClient): UnitStagePort {
  const options = { signal: interruptSignal };
  const runOptions = { ...options, timeoutMs: TEST_TIMEOUT_MS };
  return {
    listTests: async (type) => {
      switch (type) {
        case "transform": {
          return (await client.transformTest.list({}, options)).data;
        }
        case "card": {
          return (await client.cardTest.list({}, options)).data;
        }
        case "segment": {
          return (await client.segmentTest.list({}, options)).data;
        }
        case "measure": {
          return (await client.measureTest.list({}, options)).data;
        }
        case "action": {
          return (await client.actionTest.list({}, options)).data;
        }
      }
    },
    runTest: (type, testId) => {
      switch (type) {
        case "transform": {
          return client.transformTest.run(testId, runOptions);
        }
        case "card": {
          return client.cardTest.run(testId, runOptions);
        }
        case "segment": {
          return client.segmentTest.run(testId, runOptions);
        }
        case "measure": {
          return client.measureTest.run(testId, runOptions);
        }
        case "action": {
          return client.actionTest.run(testId, runOptions);
        }
      }
    },
    nowMs: () => performance.now(),
  };
}

type Report = (check: CheckOutcome) => void;

type TestCheck = CheckOutcome["check"];

// Reports a failed request as its check's verdict, or answers the stop it calls for; rethrows a bug
// or an interrupt.
function reportFailure(
  error: unknown,
  request: TestRequest,
  check: TestCheck,
  ms: number,
  report: Report,
): StageStop | null {
  const failure = testFailure(error, request);
  if (failure === null) {
    throw error;
  }
  if (failure.kind === "stop") {
    return failure.stop;
  }
  report({ check, verdict: failure.verdict, warnings: [], ms, detail: failure.detail });
  return null;
}

interface Listed {
  type: DataTestType;
  tests: readonly InstanceTest[];
}

interface ListFailure {
  type: DataTestType;
  error: unknown;
  ms: number;
}

async function listType(type: DataTestType, port: UnitStagePort): Promise<Listed | ListFailure> {
  const started = port.nowMs();
  try {
    return { type, tests: await port.listTests(type) };
  } catch (error) {
    return { type, error, ms: port.nowMs() - started };
  }
}

// A failed run costs that test alone; a failure every later request would repeat stops the stage.
async function runListed(
  { type, tests }: Listed,
  port: UnitStagePort,
  report: Report,
): Promise<StageStop | null> {
  for (const test of tests.toSorted((a, b) => a.id - b.id)) {
    const check = { kind: `${type}-test` as const, id: String(test.id), label: test.name };
    const started = port.nowMs();
    try {
      const outcome = await port.runTest(type, test.id);
      const ms = port.nowMs() - started;
      report({ check, verdict: testVerdict(outcome), warnings: [], ms, detail: outcome });
    } catch (error) {
      const stop = reportFailure(error, "run", check, port.nowMs() - started, report);
      if (stop !== null) {
        return stop;
      }
    }
  }
  return null;
}

// A type the server does not support holds no test, so it is left out, whether the client explains
// the refusal or the server has no route for it yet; a server supporting none has nothing to check,
// which stops the stage. Every type is listed before any test runs, so a stop a listing calls for
// comes before the runs.
async function runEveryType(port: UnitStagePort, report: Report): Promise<StageStop | null> {
  const listings = await Promise.all(DATA_TEST_TYPES.map((type) => listType(type, port)));
  const listed: Listed[] = [];
  const unsupported: Error[] = [];
  for (const listing of listings) {
    if ("tests" in listing) {
      listed.push(listing);
      continue;
    }
    const { type, error, ms } = listing;
    if (isUnsupportedTestType(error)) {
      unsupported.push(error);
      continue;
    }
    const check = { kind: `${type}-test` as const, id: type, label: `${type} tests` };
    const stop = reportFailure(error, "list", check, ms, report);
    if (stop !== null) {
      return stop;
    }
  }
  const [first] = unsupported;
  if (unsupported.length === DATA_TEST_TYPES.length && first !== undefined) {
    return { code: "ci.unsupported-server", message: first.message };
  }
  for (const each of listed) {
    const stop = await runListed(each, port, report);
    if (stop !== null) {
      return stop;
    }
  }
  return null;
}

// Runs every test of every type on the instance, whatever the branch changed, since the instance's
// content can break outside the branch. The stage connects only when it runs, so a missing
// credential ends the stage, not the job.
export function unitStage(connect: () => Promise<UnitStagePort>): CiStage {
  return {
    name: "unit",
    run: async (report) => {
      let port: UnitStagePort;
      try {
        port = await connect();
      } catch (error) {
        const stop = connectStop(error, "the tests did not run");
        if (stop === null) {
          throw error;
        }
        return stop;
      }
      return runEveryType(port, report);
    },
  };
}
