import { performance } from "node:perf_hooks";

import type { MetabaseClient } from "@metabase/client/client";
import type { EidTranslateEntry } from "@metabase/client/domain/eid-translation";
import type { DataTest, DataTestRunResult, DataTestType } from "@metabase/client/domain/data-test";
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
import { isUnsupportedTestType, testKind } from "../../core/data-test";
import { interruptSignal } from "../../runtime/interrupt";

export type InstanceTest = Pick<DataTest, "id" | "name">;

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
  listTests: (type: DataTestType, entityId: number) => Promise<readonly InstanceTest[]>;
  runTest: (type: DataTestType, testId: number) => Promise<DataTestRunResult>;
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
    listTests: async (type, entityId) => (await client.dataTest.list(type, entityId, options)).data,
    runTest: (type, testId) => client.dataTest.run(type, testId, runOptions),
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

// A failed run costs that test alone; a failure every later request would repeat stops the stage.
async function runTests(
  type: DataTestType,
  tests: readonly InstanceTest[],
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

const MISSING_ENTITY_DETAIL: Record<MissingEntity["kind"], CiRefusal> = {
  "not-found": ENTITY_NOT_ON_INSTANCE,
  "invalid-entity-id": INVALID_ENTITY_ID,
};

// The test list leaves out the tests the CI identity cannot read, so the entity is read first: once
// that succeeds, an empty list means the entity has no tests, rather than hidden ones. A type the
// server cannot test holds none, which an entity the branch tests cannot accept.
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
  // A test the branch holds but the instance does not list cannot run; an entity neither tests
  // reports nothing.
  if (tests.length === 0 && testedInBranch) {
    const ms = port.nowMs() - started;
    report({ check, verdict: "refused", warnings: [], ms, detail: NO_TESTS_ON_INSTANCE });
    return null;
  }
  return runTests(entity.type, tests, `${entity.name}: `, port, report);
}

async function runChanged(
  { checked, tested }: UnitScope,
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
    const testedInBranch = tested.has(checkedKey(entity));
    const stop = await checkEntity(entity, lookup.id, testedInBranch, port, report);
    if (stop !== null) {
      return stop;
    }
  }
  return null;
}

// The entities the change touched, and those a test in the branch covers, by `entityKey`.
export interface UnitScope {
  checked: readonly CheckedEntity[];
  tested: ReadonlySet<string>;
}

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
      return runChanged(scope, port, report);
    },
  };
}
