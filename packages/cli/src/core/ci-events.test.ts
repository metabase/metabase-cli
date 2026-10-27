import { describe, expect, it } from "vitest";

import { InternalError } from "@metabase/client/errors";

import { type CiEventBody, type CiStage, CiEvent, createEmitter, runStages } from "./ci-events";

const FIXED_NOW = new Date("2026-10-30T12:00:00.000Z");

interface Collector {
  events: CiEvent[];
  emit: (body: CiEventBody) => void;
}

function collector(): Collector {
  const events: CiEvent[] = [];
  const emit = createEmitter({
    job: "job-1",
    now: () => FIXED_NOW,
    write: (event) => events.push(event),
  });
  return { events, emit };
}

function stageWith(
  name: CiStage["name"],
  verdict: "passed" | "failed" | "error" | "refused",
): CiStage {
  return {
    name,
    run: async (report) => {
      report({
        check: { kind: "transform-test", id: "7", label: `${name} check` },
        verdict,
        warnings: [],
        ms: 5,
        detail: null,
      });
      return null;
    },
  };
}

describe("createEmitter", () => {
  it("stamps each event with the job, the time and an increasing sequence number", () => {
    const { events, emit } = collector();

    emit({ type: "stage.start", stage: "lint" });
    emit({ type: "stage.end", stage: "lint", status: "passed", stopped: null });

    expect(events).toEqual([
      { type: "stage.start", stage: "lint", seq: 0, job: "job-1", at: "2026-10-30T12:00:00.000Z" },
      {
        type: "stage.end",
        stage: "lint",
        status: "passed",
        stopped: null,
        seq: 1,
        job: "job-1",
        at: "2026-10-30T12:00:00.000Z",
      },
    ]);
  });

  it("refuses an event that does not match the schema", () => {
    const { events, emit } = collector();
    const negativeDuration = () =>
      emit({
        type: "check.result",
        stage: "unit",
        check: { kind: "transform-test", id: "7", label: "t" },
        verdict: "passed",
        warnings: [],
        ms: -1,
        detail: null,
      });

    expect(negativeDuration).toThrow(InternalError);
    expect(negativeDuration).toThrow('ci event "check.result" does not match its schema');
    expect(events).toEqual([]);
  });
});

describe("runStages", () => {
  it("skips every stage after one that failed", async () => {
    const { events, emit } = collector();

    const outcome = await runStages(
      [stageWith("lint", "failed"), stageWith("unit", "passed")],
      emit,
    );

    const envelope = { job: "job-1", at: "2026-10-30T12:00:00.000Z" };
    expect(outcome).toEqual({ state: "failed", checks: 1, warnings: 0 });
    expect(events).toEqual([
      { ...envelope, seq: 0, type: "stage.start", stage: "lint" },
      {
        ...envelope,
        seq: 1,
        type: "check.result",
        stage: "lint",
        check: { kind: "transform-test", id: "7", label: "lint check" },
        verdict: "failed",
        warnings: [],
        ms: 5,
        detail: null,
      },
      { ...envelope, seq: 2, type: "stage.end", stage: "lint", status: "failed", stopped: null },
      { ...envelope, seq: 3, type: "stage.end", stage: "unit", status: "skipped", stopped: null },
    ]);
  });

  it("runs every stage when each one passes", async () => {
    const { emit } = collector();

    expect(
      await runStages([stageWith("lint", "passed"), stageWith("unit", "passed")], emit),
    ).toEqual({
      state: "passed",
      checks: 2,
      warnings: 0,
    });
  });

  it("treats a check whose own query broke as an errored stage, since the check needs fixing", async () => {
    const { emit } = collector();

    expect(await runStages([stageWith("unit", "error")], emit)).toEqual({
      state: "errored",
      checks: 1,
      warnings: 0,
    });
  });

  it("lets a failed check outrank errors and refusals, since a failure is a finding about the change", async () => {
    const { emit } = collector();
    const mixed: CiStage = {
      name: "unit",
      run: async (report) => {
        for (const verdict of ["failed", "error", "refused"] as const) {
          report({
            check: { kind: "transform-test", id: verdict, label: verdict },
            verdict,
            warnings: [],
            ms: 1,
            detail: null,
          });
        }
        return null;
      },
    };

    expect(await runStages([mixed], emit)).toEqual({ state: "failed", checks: 3, warnings: 0 });
  });

  it("treats a refused check as an errored stage", async () => {
    const { emit } = collector();

    expect(await runStages([stageWith("unit", "refused")], emit)).toEqual({
      state: "errored",
      checks: 1,
      warnings: 0,
    });
  });

  it("counts the warnings the checks carry", async () => {
    const { emit } = collector();
    const warned: CiStage = {
      name: "lint",
      run: async (report) => {
        report({
          check: { kind: "coverage", id: "untouched", label: "untouched transforms" },
          verdict: "passed",
          warnings: [
            { code: "no-tests-untouched", message: "2 untouched transforms have no tests" },
          ],
          ms: 1,
          detail: null,
        });
        return null;
      },
    };

    expect(await runStages([warned], emit)).toEqual({ state: "passed", checks: 1, warnings: 1 });
  });

  it("ends a stage that stopped early errored, saying why on stage.end", async () => {
    const { events, emit } = collector();
    const stopped: CiStage = {
      name: "unit",
      run: async (report) => {
        await stageWith("unit", "passed").run(report);
        return { code: "ci.unauthorized", message: "Metabase did not accept the credential" };
      },
    };

    expect(await runStages([stopped], emit)).toEqual({ state: "errored", checks: 1, warnings: 0 });
    expect(events.at(-1)).toEqual({
      type: "stage.end",
      stage: "unit",
      status: "errored",
      stopped: { code: "ci.unauthorized", message: "Metabase did not accept the credential" },
      seq: 2,
      job: "job-1",
      at: "2026-10-30T12:00:00.000Z",
    });
  });

  it("lets a failed check outrank the stage stopping early", async () => {
    const { emit } = collector();
    const stopped: CiStage = {
      name: "unit",
      run: async (report) => {
        await stageWith("unit", "failed").run(report);
        return { code: "ci.network-error", message: "Metabase could not be reached" };
      },
    };

    expect(await runStages([stopped], emit)).toEqual({ state: "failed", checks: 1, warnings: 0 });
  });

  it("passes a job with no stages", async () => {
    const { events, emit } = collector();

    expect(await runStages([], emit)).toEqual({ state: "passed", checks: 0, warnings: 0 });
    expect(events).toEqual([]);
  });
});

describe("runStages, gating", () => {
  function recordingStage(
    name: CiStage["name"],
    verdict: "passed" | "failed" | "error",
    ran: string[],
  ): CiStage {
    return {
      name,
      run: async (report) => {
        ran.push(name);
        return stageWith(name, verdict).run(report);
      },
    };
  }

  it("does not run the stage after an errored stage", async () => {
    const { events, emit } = collector();
    const ran: string[] = [];

    const outcome = await runStages(
      [recordingStage("lint", "error", ran), recordingStage("unit", "passed", ran)],
      emit,
    );

    expect(outcome).toEqual({ state: "errored", checks: 1, warnings: 0 });
    expect(ran).toEqual(["lint"]);
    expect(events.at(-1)).toEqual({
      type: "stage.end",
      stage: "unit",
      status: "skipped",
      stopped: null,
      seq: 3,
      job: "job-1",
      at: "2026-10-30T12:00:00.000Z",
    });
  });

  it("does not run the stage after a failed stage", async () => {
    const { emit } = collector();
    const ran: string[] = [];

    await runStages(
      [recordingStage("lint", "failed", ran), recordingStage("unit", "passed", ran)],
      emit,
    );

    expect(ran).toEqual(["lint"]);
  });
});

describe("createEmitter, sequence numbers", () => {
  it("does not spend a sequence number on a refused event", () => {
    const { events, emit } = collector();
    const refused = () =>
      emit({
        type: "check.result",
        stage: "unit",
        check: { kind: "transform-test", id: "7", label: "t" },
        verdict: "passed",
        warnings: [],
        ms: -1,
        detail: null,
      });

    expect(refused).toThrow(InternalError);
    emit({ type: "stage.start", stage: "unit" });

    expect(events.map((event) => event.seq)).toEqual([0]);
  });

  it("refuses a fractional seq", () => {
    const event = {
      type: "stage.start",
      stage: "unit",
      seq: 0.5,
      job: "job-1",
      at: "2026-10-30T12:00:00.000Z",
    };

    expect(CiEvent.safeParse(event).success).toBe(false);
  });
});
