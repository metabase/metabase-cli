import { z } from "zod";

import { DataTestType } from "@metabase/client/domain/data-test";
import { InternalError } from "@metabase/client/errors";

import { TEST_KINDS } from "./data-test";

export const CI_EVENT_VERSION = 2;

const StageName = z.enum(["lint", "unit"]);
type StageName = z.infer<typeof StageName>;

// `failed`: the change is wrong. `error` (the check could not judge the change) and `refused`
// (Metabase would not run it): the check or the setup needs fixing, so the stage and job are
// `errored`. A failure outranks both: a failure is a finding about the change, an error a finding
// about the test or the setup.
const Verdict = z.enum(["passed", "failed", "error", "refused"]);
export type Verdict = z.infer<typeof Verdict>;

// A stage's status and the job's state: the job takes the worst status among its stages.
const JobState = z.enum(["passed", "failed", "errored"]);
export type JobState = z.infer<typeof JobState>;

const CiWarning = z.object({ code: z.string(), message: z.string() });
export type CiWarning = z.infer<typeof CiWarning>;

// Why a stage stopped before it checked everything, such as a server that refused the credential.
const StageStop = z.object({ code: z.string(), message: z.string() });
export type StageStop = z.infer<typeof StageStop>;

const CheckedEntity = z.object({ type: DataTestType, entity_id: z.string(), name: z.string() });
export type CheckedEntity = z.infer<typeof CheckedEntity>;

const Snapshot = z.object({ base: z.string(), head: z.string() });
export type Snapshot = z.infer<typeof Snapshot>;

const Check = z.object({
  kind: z.enum(["yaml", "cycles", "broken-refs", ...TEST_KINDS]),
  id: z.string(),
  label: z.string(),
});

export type CheckKind = z.infer<typeof Check>["kind"];

const EventEnvelope = z.object({
  seq: z.number().int().nonnegative(),
  job: z.string(),
  at: z.iso.datetime(),
});

const JobStart = EventEnvelope.extend({
  type: z.literal("job.start"),
  v: z.literal(CI_EVENT_VERSION),
  snapshot: Snapshot,
  checked: z.array(CheckedEntity),
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

// `stopped` is null when the stage ran every check. `skipped` says why a stage ran no check at all,
// for a server without what it reads, and passes the stage; it is null when the stage ran.
const StageEnd = EventEnvelope.extend({
  type: z.literal("stage.end"),
  stage: StageName,
  status: JobState,
  stopped: StageStop.nullable(),
  skipped: StageStop.nullable(),
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

export interface StageSkip {
  skipped: StageStop;
}

// `run` answers why it stopped early, why it was skipped, or null when it ran every check. A stage
// throws only on a bug or an interrupt, which crash the job.
export interface CiStage {
  name: StageName;
  run: (report: (check: CheckOutcome) => void) => Promise<StageStop | StageSkip | null>;
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

function jobState(statuses: readonly JobState[]): JobState {
  if (statuses.includes("failed")) {
    return "failed";
  }
  return statuses.includes("errored") ? "errored" : "passed";
}

interface StagesOutcome {
  state: JobState;
  checks: number;
  warnings: number;
}

// Every stage runs whatever the stages before it found, so one job reports every finding.
export async function runStages(
  stages: readonly CiStage[],
  emit: (body: CiEventBody) => void,
): Promise<StagesOutcome> {
  const statuses: JobState[] = [];
  let checks = 0;
  let warnings = 0;
  for (const stage of stages) {
    emit({ type: "stage.start", stage: stage.name });
    const verdicts: Verdict[] = [];
    const ending = await stage.run((check) => {
      verdicts.push(check.verdict);
      checks += 1;
      warnings += check.warnings.length;
      emit({ type: "check.result", stage: stage.name, ...check });
    });
    const skipped = ending !== null && "skipped" in ending ? ending.skipped : null;
    const stopped = ending !== null && "code" in ending ? ending : null;
    const status = stageStatus(verdicts, stopped);
    statuses.push(status);
    emit({ type: "stage.end", stage: stage.name, status, stopped, skipped });
  }
  return { state: jobState(statuses), checks, warnings };
}
