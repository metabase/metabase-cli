import { performance } from "node:perf_hooks";

import type { MetabaseClient } from "@metabase/client/client";
import type { DataTestType } from "@metabase/client/domain/data-test";
import type { EidTranslateEntry } from "@metabase/client/domain/eid-translation";
import { InternalError } from "@metabase/client/errors";
import type { TransformTest, TransformTestRunResult } from "@metabase/client/domain/transform-test";

import { entityKey } from "../../core/ci-affected";
import type { CheckedEntity, CheckOutcome, CiStage, StageStop } from "../../core/ci-events";
import {
  type CiRefusal,
  type TestRequest,
  type UnitFailure,
  connectStop,
  invalidEntityId,
  lookupStop,
  noTestsOnInstance,
  notOnInstance,
  testFailure,
  testVerdict,
} from "../../core/ci-unit";
import { testKind } from "../../core/data-test";
import { interruptSignal } from "../../runtime/interrupt";

interface FoundEntity {
  kind: "found";
  id: number;
}

interface MissingEntity {
  kind: "not-found" | "invalid-entity-id";
}

type EntityLookup = FoundEntity | MissingEntity;

type InstanceTest = Pick<TransformTest, "id" | "name">;

export interface UnitStagePort {
  lookUpEntities: (
    entities: readonly CheckedEntity[],
  ) => Promise<ReadonlyMap<string, EntityLookup>>;
  readEntity: (type: DataTestType, id: number) => Promise<void>;
  listTests: (type: DataTestType, id: number) => Promise<readonly InstanceTest[]>;
  runTest: (type: DataTestType, testId: number) => Promise<TransformTestRunResult>;
  nowMs: () => number;
}

// One test is a single synchronous request; this bounds how long the CLI waits for it.
const TEST_TIMEOUT_MS = 120_000;
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

function entityIdsByType(
  entities: readonly CheckedEntity[],
): Partial<Record<DataTestType, string[]>> {
  const byType: Partial<Record<DataTestType, string[]>> = {};
  for (const { type, entity_id } of entities) {
    const ids = byType[type];
    if (ids === undefined) {
      byType[type] = [entity_id];
    } else {
      ids.push(entity_id);
    }
  }
  return byType;
}

export function clientPort(client: MetabaseClient): UnitStagePort {
  const options = { signal: interruptSignal };
  const runOptions = { ...options, timeoutMs: TEST_TIMEOUT_MS };
  return {
    lookUpEntities: async (entities) => {
      const result = await client.eidTranslation.translate(
        { entity_ids: entityIdsByType(entities) },
        options,
      );
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
      }
    },
    listTests: async (type, id) => {
      switch (type) {
        case "transform": {
          return (await client.transformTest.list({ "transform-id": id }, options)).data;
        }
        case "card": {
          return (await client.cardTest.list({ "card-id": id }, options)).data;
        }
        case "segment": {
          return (await client.segmentTest.list({ "segment-id": id }, options)).data;
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
      }
    },
    nowMs: () => performance.now(),
  };
}

interface Settled<T> {
  kind: "settled";
  value: T;
}

// A failure the stage cannot report, a bug or an interrupt, is rethrown.
async function attempt<T>(
  request: TestRequest,
  type: DataTestType,
  call: () => Promise<T>,
): Promise<Settled<T> | UnitFailure> {
  try {
    return { kind: "settled", value: await call() };
  } catch (error) {
    const failure = testFailure(error, request, type);
    if (failure === null) {
      throw error;
    }
    return failure;
  }
}

type Report = (check: CheckOutcome) => void;
type TestCheck = CheckOutcome["check"];

interface EntityCheck {
  entity: CheckedEntity;
  check: TestCheck;
  testedInBranch: boolean;
}

type UnsupportedTypes = Map<DataTestType, CiRefusal>;

function reportUnsupportedType(target: EntityCheck, detail: CiRefusal, report: Report): void {
  if (target.testedInBranch) {
    report({ check: target.check, verdict: "refused", warnings: [], ms: 0, detail });
  }
}

// Reports a failure that costs one check, and answers the stop of one that ends the stage.
function reportFailure(
  failure: UnitFailure,
  target: EntityCheck,
  check: TestCheck,
  ms: number,
  report: Report,
  unsupported: UnsupportedTypes,
): StageStop | null {
  if (failure.kind === "stop") {
    return failure.stop;
  }
  if (failure.kind === "unsupported-type") {
    unsupported.set(target.entity.type, failure.detail);
    reportUnsupportedType(target, failure.detail, report);
    return null;
  }
  report({ check, verdict: failure.verdict, warnings: [], ms, detail: failure.detail });
  return null;
}

async function checkEntity(
  target: EntityCheck,
  id: number,
  port: UnitStagePort,
  report: Report,
  unsupported: UnsupportedTypes,
): Promise<StageStop | null> {
  const { entity, check: entityCheck } = target;
  const { type } = entity;
  const started = port.nowMs();
  // The test list leaves out the tests the CI identity cannot read, so the entity is read first:
  // once that succeeds, an empty list means the entity has no tests, rather than hidden ones.
  const read = await attempt("read", type, () => port.readEntity(type, id));
  if (read.kind !== "settled") {
    return reportFailure(read, target, entityCheck, port.nowMs() - started, report, unsupported);
  }
  const tests = await attempt("list", type, () => port.listTests(type, id));
  if (tests.kind !== "settled") {
    return reportFailure(tests, target, entityCheck, port.nowMs() - started, report, unsupported);
  }
  // An entity the branch has no test for is the coverage check's to report.
  if (tests.value.length === 0 && target.testedInBranch) {
    report({
      check: entityCheck,
      verdict: "refused",
      warnings: [],
      ms: port.nowMs() - started,
      detail: noTestsOnInstance(type),
    });
    return null;
  }
  for (const test of tests.value.toSorted((a, b) => a.id - b.id)) {
    const check = {
      kind: testKind(type),
      id: String(test.id),
      label: `${entity.name}: ${test.name}`,
    };
    const runStarted = port.nowMs();
    const run = await attempt("run", type, () => port.runTest(type, test.id));
    const ms = port.nowMs() - runStarted;
    if (run.kind === "settled") {
      report({ check, verdict: testVerdict(run.value), warnings: [], ms, detail: run.value });
      continue;
    }
    const stop = reportFailure(run, target, check, ms, report, unsupported);
    if (stop !== null) {
      return stop;
    }
  }
  return null;
}

function missingEntityDetail(kind: MissingEntity["kind"], type: DataTestType): CiRefusal {
  return kind === "not-found" ? notOnInstance(type) : invalidEntityId(type);
}

// The stage connects only when it runs, so the lint stage reports before a server is asked for.
// For a check on a whole entity, `check.id` is its entity_id; for a test run, the test's id.
export function unitStage(
  checked: readonly CheckedEntity[],
  testedInBranch: ReadonlySet<string>,
  connect: () => Promise<UnitStagePort>,
): CiStage {
  return {
    name: "unit",
    run: async (report) => {
      let port: UnitStagePort;
      try {
        port = await connect();
      } catch (error) {
        const stop = connectStop(error);
        if (stop === null) {
          throw error;
        }
        return stop;
      }
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
      const unsupported: UnsupportedTypes = new Map();
      for (const entity of checked) {
        const key = checkedKey(entity);
        const lookup = lookups.get(key);
        if (lookup === undefined) {
          throw new InternalError(`no lookup for ${entity.type} ${entity.entity_id}`);
        }
        const target: EntityCheck = {
          entity,
          check: { kind: testKind(entity.type), id: entity.entity_id, label: entity.name },
          testedInBranch: testedInBranch.has(key),
        };
        if (lookup.kind !== "found") {
          report({
            check: target.check,
            verdict: "refused",
            warnings: [],
            ms: 0,
            detail: missingEntityDetail(lookup.kind, entity.type),
          });
          continue;
        }
        const refusal = unsupported.get(entity.type);
        if (refusal !== undefined) {
          reportUnsupportedType(target, refusal, report);
          continue;
        }
        const stop = await checkEntity(target, lookup.id, port, report, unsupported);
        if (stop !== null) {
          return stop;
        }
      }
      return null;
    },
  };
}
