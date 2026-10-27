import { z } from "zod";

import { InternalError } from "@metabase/client/errors";

export const CI_EVENT_VERSION = 1;

const StageName = z.enum(["lint", "unit"]);
type StageName = z.infer<typeof StageName>;

// `failed`: the change is wrong. `error` (the check could not judge the change) and `refused`
// (Metabase would not run it): the check or the setup needs fixing, so the stage and job are
// `errored`. A failure outranks both: a failure is a finding about the change, an error a finding
// about the test or the setup.
const Verdict = z.enum(["passed", "failed", "error", "refused"]);
export type Verdict = z.infer<typeof Verdict>;

const StageStatus = z.enum(["passed", "failed", "errored", "skipped"]);

const JobState = StageStatus.exclude(["skipped"]);
export type JobState = z.infer<typeof JobState>;

const CiWarning = z.object({ code: z.string(), message: z.string() });
export type CiWarning = z.infer<typeof CiWarning>;

// Why a stage stopped before it checked everything, such as a server that refused the credential.
const StageStop = z.object({ code: z.string(), message: z.string() });
export type StageStop = z.infer<typeof StageStop>;

const CheckedTransform = z.object({ entity_id: z.string(), name: z.string() });
export type CheckedTransform = z.infer<typeof CheckedTransform>;

const Snapshot = z.object({ base: z.string(), head: z.string() });
export type Snapshot = z.infer<typeof Snapshot>;

const Check = z.object({
  kind: z.enum(["coverage", "lint", "yaml", "cycles", "broken-refs", "transform-test"]),
  id: z.string(),
  label: z.string(),
});

const EventEnvelope = z.object({
  seq: z.number().int().nonnegative(),
  job: z.string(),
  at: z.iso.datetime(),
});

const JobStart = EventEnvelope.extend({
  type: z.literal("job.start"),
  v: z.literal(CI_EVENT_VERSION),
  snapshot: Snapshot,
  checked: z.array(CheckedTransform),
  warnings: z.array(CiWarning),
});

const StageStart = EventEnvelope.extend({ type: z.literal("stage.start"), stage: StageName });

const CheckResult = EventEnvelope.extend({
  type: z.literal("check.result"),
  stage: StageName,
  check: Check,
  verdict: Verdict,
  warnings: z.array(CiWarning),
  ms: z.number().nonnegative(),
  detail: z.unknown(),
});

// `stopped` is null when the stage ran every check, or was skipped.
const StageEnd = EventEnvelope.extend({
  type: z.literal("stage.end"),
  stage: StageName,
  status: StageStatus,
  stopped: StageStop.nullable(),
});

const JobEnd = EventEnvelope.extend({
  type: z.literal("job.end"),
  state: JobState,
  counts: z.object({ checks: z.number().int(), warnings: z.number().int() }),
});

export const CiEvent = z.discriminatedUnion("type", [
  JobStart,
  StageStart,
  CheckResult,
  StageEnd,
  JobEnd,
]);
export type CiEvent = z.infer<typeof CiEvent>;

type EnvelopeKey = keyof z.infer<typeof EventEnvelope>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type CiEventBody = DistributiveOmit<CiEvent, EnvelopeKey>;
export type CheckOutcome = Omit<Extract<CiEventBody, { type: "check.result" }>, "type" | "stage">;

// `run` answers why it stopped early, or null when it ran every check. A stage throws only on a bug
// or an interrupt, which crash the job.
export interface CiStage {
  name: StageName;
  run: (report: (check: CheckOutcome) => void) => Promise<StageStop | null>;
}

interface CiEmitterOptions {
  job: string;
  now: () => Date;
  write: (event: CiEvent) => void;
}

// A malformed event is a bug in the runner, never something a user caused.
export function createEmitter(options: CiEmitterOptions): (body: CiEventBody) => CiEvent {
  let seq = 0;
  return (body) => {
    const parsed = CiEvent.safeParse({
      ...body,
      seq,
      job: options.job,
      at: options.now().toISOString(),
    });
    if (!parsed.success) {
      throw new InternalError(
        `ci event "${body.type}" does not match its schema: ${parsed.error.message}`,
      );
    }
    seq += 1;
    options.write(parsed.data);
    return parsed.data;
  };
}

// A stage that stopped early is `errored` unless a check it reported failed.
function stageStatus(verdicts: readonly Verdict[], stopped: StageStop | null): JobState {
  if (verdicts.includes("failed")) {
    return "failed";
  }
  if (stopped !== null || verdicts.includes("refused") || verdicts.includes("error")) {
    return "errored";
  }
  return "passed";
}

interface StagesOutcome {
  state: JobState;
  checks: number;
  warnings: number;
}

// Stages gate each other: once one has not passed, the rest are reported as skipped rather than
// run, so a reader never mistakes a missing stage for a passing one.
export async function runStages(
  stages: readonly CiStage[],
  emit: (body: CiEventBody) => void,
): Promise<StagesOutcome> {
  let state: JobState = "passed";
  let checks = 0;
  let warnings = 0;
  for (const stage of stages) {
    if (state !== "passed") {
      emit({ type: "stage.end", stage: stage.name, status: "skipped", stopped: null });
      continue;
    }
    emit({ type: "stage.start", stage: stage.name });
    const verdicts: Verdict[] = [];
    const stopped = await stage.run((check) => {
      verdicts.push(check.verdict);
      checks += 1;
      warnings += check.warnings.length;
      emit({ type: "check.result", stage: stage.name, ...check });
    });
    state = stageStatus(verdicts, stopped);
    emit({ type: "stage.end", stage: stage.name, status: state, stopped });
  }
  return { state, checks, warnings };
}
