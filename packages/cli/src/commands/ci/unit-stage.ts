import { performance } from "node:perf_hooks";

import type { MetabaseClient } from "@metabase/client/client";
import { DATA_TEST_TYPES, type DataTestType } from "@metabase/client/domain/data-test";
import type { TransformTestRunResult } from "@metabase/client/domain/transform-test";
import { HttpError } from "@metabase/client/http/errors";
import { CapabilityError } from "@metabase/client/version/capability-error";

import type { CheckOutcome, CiStage, StageStop } from "../../core/ci-events";
import { connectStop, testVerdict, transformFailure } from "../../core/ci-unit";
import { interruptSignal } from "../../runtime/interrupt";

export interface InstanceTest {
  id: number;
  name: string;
}

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

function isUnsupportedType(error: unknown): error is CapabilityError | HttpError {
  return (
    error instanceof CapabilityError ||
    (error instanceof HttpError && error.kind === "route-missing")
  );
}

interface Listed {
  type: DataTestType;
  tests: readonly InstanceTest[];
}

interface TypeListing {
  listed: Listed[];
  unsupported: (CapabilityError | HttpError)[];
}

// A type the server does not support holds no test, so it is left out, whether the client explains
// the refusal or the server has no route for it yet; a server supporting none has nothing to check,
// which stops the stage.
async function listEveryType(
  port: UnitStagePort,
  report: Report,
): Promise<TypeListing | StageStop> {
  const listing: TypeListing = { listed: [], unsupported: [] };
  for (const type of DATA_TEST_TYPES) {
    const started = port.nowMs();
    try {
      listing.listed.push({ type, tests: await port.listTests(type) });
    } catch (error) {
      if (isUnsupportedType(error)) {
        listing.unsupported.push(error);
        continue;
      }
      const failure = transformFailure(error, "list");
      if (failure === null) {
        throw error;
      }
      if (failure.kind === "stop") {
        return failure.stop;
      }
      report({
        check: { kind: `${type}-test`, id: type, label: `${type} tests` },
        verdict: failure.verdict,
        warnings: [],
        ms: port.nowMs() - started,
        detail: failure.detail,
      });
    }
  }
  const [first] = listing.unsupported;
  if (listing.unsupported.length === DATA_TEST_TYPES.length && first !== undefined) {
    return { code: "ci.unsupported-server", message: first.message };
  }
  return listing;
}

function isStop(value: TypeListing | StageStop): value is StageStop {
  return "code" in value;
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
      const failure = transformFailure(error, "run");
      if (failure === null) {
        throw error;
      }
      if (failure.kind === "stop") {
        return failure.stop;
      }
      const ms = port.nowMs() - started;
      report({ check, verdict: failure.verdict, warnings: [], ms, detail: failure.detail });
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
      const listing = await listEveryType(port, report);
      if (isStop(listing)) {
        return listing;
      }
      for (const listed of listing.listed) {
        const stop = await runListed(listed, port, report);
        if (stop !== null) {
          return stop;
        }
      }
      return null;
    },
  };
}
