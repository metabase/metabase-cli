import { performance } from "node:perf_hooks";

import type { MetabaseClient } from "@metabase/client/client";
import { DATA_TEST_TYPES, type DataTestType } from "@metabase/client/domain/data-test";
import type { EidTranslateEntry } from "@metabase/client/domain/eid-translation";
import type { TransformTestRunResult } from "@metabase/client/domain/transform-test";
import { InternalError } from "@metabase/client/errors";

import { entityKey } from "../../core/ci-affected";
import type { CheckedEntity, CheckOutcome, CiStage, StageStop } from "../../core/ci-events";
import {
  type CiRefusal,
  type TestRequest,
  connectStop,
  INVALID_ENTITY_ID,
  lookupStop,
  NO_TESTS_ON_INSTANCE,
  ENTITY_NOT_ON_INSTANCE,
  testFailure,
  testVerdict,
} from "../../core/ci-unit";
import { type AnyTest, isUnsupportedTestType, testKind } from "../../core/data-test";
import { interruptSignal } from "../../runtime/interrupt";

export type InstanceTest = Pick<AnyTest, "id" | "name">;

interface FoundEntity {
  kind: "found";
  id: number;
}

interface MissingEntity {
  kind: "not-found" | "invalid-entity-id";
}

export type EntityLookup = FoundEntity | MissingEntity;

export interface UnitStagePort {
  // Keyed by `entityKey`.
  lookUpEntities: (
    entities: readonly CheckedEntity[],
  ) => Promise<ReadonlyMap<string, EntityLookup>>;
  readEntity: (type: DataTestType, id: number) => Promise<void>;
  // `entityId` null lists every test of the type.
  listTests: (type: DataTestType, entityId: number | null) => Promise<readonly InstanceTest[]>;
  runTest: (type: DataTestType, testId: number) => Promise<TransformTestRunResult>;
  nowMs: () => number;
}

const OK_STATUS = "ok";

const LOOKUP_KIND_BY_STATUS: ReadonlyMap<string, MissingEntity["kind"]> = new Map([
  ["not-found", "not-found"],
  ["invalid-format", "invalid-entity-id"],
]);

// The server answers every entity id it was asked about, as `ok` with an id, `not-found` or
// `invalid-format`; anything else breaks its contract.
function entityLookup(entityId: string, entry: EidTranslateEntry | undefined): EntityLookup {
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

function checkedKey(entity: CheckedEntity): string {
  return entityKey({ type: entity.type, entityId: entity.entity_id });
}

// One test run is a single synchronous request; this bounds how long the CLI waits for it.
const TEST_TIMEOUT_MS = 120_000;

export function clientPort(client: MetabaseClient): UnitStagePort {
  const options = { signal: interruptSignal };
  const runOptions = { ...options, timeoutMs: TEST_TIMEOUT_MS };
  return {
    lookUpEntities: async (entities) => {
      const entityIds: Partial<Record<DataTestType, string[]>> = {};
      for (const { type, entity_id } of entities) {
        const ids = entityIds[type];
        if (ids === undefined) {
          entityIds[type] = [entity_id];
        } else {
          ids.push(entity_id);
        }
      }
      const result = await client.eidTranslation.translate({ entity_ids: entityIds }, options);
      const lookups = new Map<string, EntityLookup>();
      for (const entity of entities) {
        const entry = result.entity_ids[entity.entity_id];
        lookups.set(checkedKey(entity), entityLookup(entity.entity_id, entry));
      }
      return lookups;
    },
    readEntity: async (type, id) => {
      switch (type) {
        case "transform": {
          await client.transform.get(id, options);
          return;
        }
        case "card": {
          await client.card.get(id, options);
          return;
        }
        case "segment": {
          await client.segment.get(id, options);
          return;
        }
        case "measure": {
          await client.measure.get(id, options);
          return;
        }
        case "action": {
          await client.dataAction.get(id, options);
          return;
        }
      }
    },
    listTests: async (type, entityId) => {
      // The list's query omits an undefined filter.
      const of = entityId === null ? undefined : entityId;
      switch (type) {
        case "transform": {
          return (await client.transformTest.list({ "transform-id": of }, options)).data;
        }
        case "card": {
          return (await client.cardTest.list({ "card-id": of }, options)).data;
        }
        case "segment": {
          return (await client.segmentTest.list({ "segment-id": of }, options)).data;
        }
        case "measure": {
          return (await client.measureTest.list({ "measure-id": of }, options)).data;
        }
        case "action": {
          return (await client.actionTest.list({ "action-id": of }, options)).data;
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
    return { type, tests: await port.listTests(type, null) };
  } catch (error) {
    return { type, error, ms: port.nowMs() - started };
  }
}

// A failed run costs that test alone; a failure every later request would repeat stops the stage.
async function runListed(
  { type, tests }: Listed,
  labelPrefix: string,
  port: UnitStagePort,
  report: Report,
): Promise<StageStop | null> {
  for (const test of tests.toSorted((a, b) => a.id - b.id)) {
    const check = { kind: testKind(type), id: String(test.id), label: labelPrefix + test.name };
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
    const check = { kind: testKind(type), id: type, label: `${type} tests` };
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
    const stop = await runListed(each, "", port, report);
    if (stop !== null) {
      return stop;
    }
  }
  return null;
}

const MISSING_ENTITY_DETAIL: Record<MissingEntity["kind"], CiRefusal> = {
  "not-found": ENTITY_NOT_ON_INSTANCE,
  "invalid-entity-id": INVALID_ENTITY_ID,
};

// The test list leaves out the tests the CI identity cannot read, so the entity is read first: once
// that succeeds, an empty list means the entity has no tests, rather than hidden ones. A type the
// server cannot test holds none, which only a transform the branch tests cannot accept.
async function checkEntity(
  entity: CheckedEntity,
  id: number,
  testedInBranch: boolean,
  port: UnitStagePort,
  report: Report,
): Promise<StageStop | null> {
  const check = { kind: testKind(entity.type), id: entity.entity_id, label: entity.name };
  const started = port.nowMs();
  try {
    await port.readEntity(entity.type, id);
  } catch (error) {
    return reportFailure(error, "read", check, port.nowMs() - started, report);
  }
  let tests: readonly InstanceTest[];
  try {
    tests = await port.listTests(entity.type, id);
  } catch (error) {
    if (isUnsupportedTestType(error) && !testedInBranch) {
      return null;
    }
    return reportFailure(error, "list", check, port.nowMs() - started, report);
  }
  if (tests.length === 0 && testedInBranch) {
    const ms = port.nowMs() - started;
    report({ check, verdict: "refused", warnings: [], ms, detail: NO_TESTS_ON_INSTANCE });
    return null;
  }
  return runListed({ type: entity.type, tests }, `${entity.name}: `, port, report);
}

async function runChanged(
  { checked, tested }: ChangedScope,
  port: UnitStagePort,
  report: Report,
): Promise<StageStop | null> {
  let lookups: ReadonlyMap<string, EntityLookup>;
  try {
    lookups = await port.lookUpEntities(checked);
  } catch (error) {
    const stop = lookupStop(error);
    if (stop === null) {
      throw error;
    }
    return stop;
  }
  for (const entity of checked) {
    const lookup = lookups.get(checkedKey(entity));
    if (lookup === undefined) {
      throw new InternalError(`no lookup for ${entity.type} ${entity.entity_id}`);
    }
    if (lookup.kind !== "found") {
      report({
        check: { kind: testKind(entity.type), id: entity.entity_id, label: entity.name },
        verdict: "refused",
        warnings: [],
        ms: 0,
        detail: MISSING_ENTITY_DETAIL[lookup.kind],
      });
      continue;
    }
    const testedInBranch = entity.type === "transform" && tested.has(entity.entity_id);
    const stop = await checkEntity(entity, lookup.id, testedInBranch, port, report);
    if (stop !== null) {
      return stop;
    }
  }
  return null;
}

interface EveryScope {
  kind: "every";
}

// The entities the change touched, and the transforms a test in the branch covers.
interface ChangedScope {
  kind: "changed";
  checked: readonly CheckedEntity[];
  tested: ReadonlySet<string>;
}

export type UnitScope = EveryScope | ChangedScope;

// The stage connects only when it runs, so a missing credential ends the stage, not the job.
export function unitStage(scope: UnitScope, connect: () => Promise<UnitStagePort>): CiStage {
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
      return scope.kind === "every" ? runEveryType(port, report) : runChanged(scope, port, report);
    },
  };
}
