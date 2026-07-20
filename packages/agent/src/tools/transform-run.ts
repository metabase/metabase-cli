import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Client } from "@metabase/cli/client";
import {
  Transform,
  TransformCompact,
  TransformJob,
  TransformJobCompact,
  TransformRun,
  TransformRunCompact,
} from "@metabase/cli/domain";
import { collectPaginated } from "@metabase/cli/paginate";
import { type Static, Type } from "typebox";
import { z } from "zod";
import { assertCapabilities } from "./capability";
import type { MetabaseToolDeps } from "./deps";
import { buildListEnvelope } from "./envelope";
import { pollUntil, resolveTimeoutMs, resolveWait, timeoutMsParam, waitParam } from "./poll";
import { type ResponseFormat, resolveResponseFormat, responseFormatParam } from "./response-format";
import { TeachingError } from "./teaching-error";
import { guardTool, jsonResult, listResult, type TextToolResult } from "./tool-result";
import { TRANSFORM_CAPABILITIES } from "./transform-write";

const TOOL_NAME = "transform_run";

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "timeout", "canceled"]);
const FAILURE_STATUSES = new Set(["failed", "timeout", "canceled"]);

const ACTIONS = [
  "run",
  "cancel",
  "list_runs",
  "get_run",
  "dependencies",
  "list_jobs",
  "job_transforms",
  "run_job",
] as const;
type Action = (typeof ACTIONS)[number];

const TransformRunKickoff = z.object({
  message: z.string(),
  run_id: z.number().int().positive().nullable(),
});

const TransformJobRunKickoff = z.object({
  message: z.string(),
  job_run_id: z.string(),
});

const TransformList = z.array(Transform);
const TransformJobList = z.array(TransformJob);

const parameters = Type.Object({
  action: Type.Unsafe<Action>({
    type: "string",
    enum: [...ACTIONS],
    description:
      "`run` a transform (needs `id`) · `cancel` its in-flight run (needs `id`) · `list_runs` the run history (optionally `transform_id`) · `get_run` one run by run id (needs `id`) · `dependencies` — the upstream transforms that must run first (needs `id`) · `list_jobs` the schedules · `job_transforms` — what a job would run (needs `id`) · `run_job` a schedule now (needs `id`).",
  }),
  id: Type.Optional(
    Type.Integer({
      description:
        "The transform id for `run`, `cancel` and `dependencies`; the run id for `get_run`; the job id for `run_job` and `job_transforms`.",
    }),
  ),
  wait: waitParam,
  sync: Type.Optional(
    Type.Boolean({
      description:
        "`run` only (default `true`): after the run succeeds, also wait until its output table is registered in Metabase and return `target_table_id` — the table id you build MBQL against. Without it the table exists in the warehouse but you do not have its id yet.",
    }),
  ),
  force_refresh: Type.Optional(
    Type.Boolean({
      description:
        "`run_job` only: re-run the whole plan including dependencies that are already fresh. Default `false` skips the fresh ones.",
    }),
  ),
  timeout_ms: timeoutMsParam,
  transform_id: Type.Optional(
    Type.Integer({ description: "`list_runs`: only runs of this transform." }),
  ),
  limit: Type.Optional(Type.Integer({ description: "`list_runs`: cap the runs returned." })),
  response_format: responseFormatParam,
});

export function transformRunTool(deps: MetabaseToolDeps): ToolDefinition {
  return defineTool({
    name: TOOL_NAME,
    label: "Run transform",
    description:
      'Operate transforms: run one and block until it finishes, cancel an in-flight run, read the run history, walk the dependency graph, and drive the jobs that run transforms on a schedule.\n\n`run` waits by default and returns the terminal status — a failed run comes back as an error carrying the server\'s own message, which is the answer, not a fault to route around. It also returns `target_table_id`, so the next call can query the transform\'s output without a separate schema sync.\n\nExamples: `{action: "run", id: 3}` · `{action: "list_runs", transform_id: 3, limit: 5}` · `{action: "run_job", id: 1}`',
    parameters,
    execute: (_id, params) => runTransformRunTool(deps, params),
  });
}

type TransformRunParams = Static<typeof parameters>;

export function runTransformRunTool(
  deps: MetabaseToolDeps,
  params: TransformRunParams,
): Promise<TextToolResult> {
  return guardTool(async () => {
    assertCapabilities(deps.instance, TRANSFORM_CAPABILITIES, TOOL_NAME);
    return await run(deps, params, resolveResponseFormat(params.response_format));
  });
}

async function run(
  deps: MetabaseToolDeps,
  params: TransformRunParams,
  format: ResponseFormat,
): Promise<TextToolResult> {
  switch (params.action) {
    case "run": {
      return await runTransform(deps, params);
    }
    case "cancel": {
      const id = requireId(params, "the transform whose run you want to cancel");
      await deps.client.requestRaw(`/api/transform/${String(id)}/cancel`, {
        method: "POST",
        expectContentType: "binary",
      });
      return jsonResult(`canceled the current run of transform ${String(id)}`, {
        transform_id: id,
        canceled: true,
      });
    }
    case "list_runs": {
      return await listRuns(deps, params, format);
    }
    case "get_run": {
      const id = requireId(params, "the run you want");
      const found = await deps.client.requestParsed(
        TransformRun,
        `/api/transform/run/${String(id)}`,
      );
      return jsonResult(`run ${String(id)}`, project(found, TransformRunCompact, format));
    }
    case "dependencies": {
      const id = requireId(params, "the transform whose dependencies you want");
      const items = await deps.client.requestParsed(
        TransformList,
        `/api/transform/${String(id)}/dependencies`,
      );
      return transformListResult(items, format, `upstream of transform ${String(id)}`);
    }
    case "list_jobs": {
      const items = await deps.client.requestParsed(TransformJobList, "/api/transform-job");
      const envelope = buildListEnvelope(
        items.map((item) => project(item, TransformJobCompact, format)),
        { steering: { noun: "transform jobs" }, total: items.length },
      );
      return listResult("transform jobs", envelope, format);
    }
    case "job_transforms": {
      const id = requireId(params, "the job whose transforms you want");
      const items = await deps.client.requestParsed(
        TransformList,
        `/api/transform-job/${String(id)}/transforms`,
      );
      return transformListResult(items, format, `run by job ${String(id)}`);
    }
    case "run_job": {
      const id = requireId(params, "the job you want to run");
      const kickoff = await deps.client.requestParsed(
        TransformJobRunKickoff,
        `/api/transform-job/${String(id)}/run`,
        { method: "POST", body: { run_all: params.force_refresh === true } },
      );
      return jsonResult(
        `started job ${String(id)} — it runs its transforms in the background; \`list_runs\` shows their progress`,
        kickoff,
      );
    }
  }
}

interface RunOutcome {
  run_id: number;
  status: string;
  message: string | null;
  target_table_id?: number | null;
}

async function runTransform(
  deps: MetabaseToolDeps,
  params: TransformRunParams,
): Promise<TextToolResult> {
  const id = requireId(params, "the transform you want to run");
  const timeoutMs = resolveTimeoutMs(params.timeout_ms);
  const syncTarget = params.sync ?? true;
  const wait = resolveWait(params.wait) || syncTarget;

  const kickoff = await deps.client.requestParsed(
    TransformRunKickoff,
    `/api/transform/${String(id)}/run`,
    { method: "POST" },
  );
  if (kickoff.run_id === null) {
    throw new TeachingError(
      `Transform ${String(id)} did not start: ${kickoff.message} A run already in flight is the usual cause — \`{action: "list_runs", transform_id: ${String(id)}}\` shows it.`,
    );
  }
  const runId = kickoff.run_id;

  if (!wait) {
    return jsonResult(`started run ${String(runId)} of transform ${String(id)}`, {
      run_id: runId,
      transform_id: id,
      message: kickoff.message,
    });
  }

  const final = await pollUntil(
    async () => deps.client.requestParsed(TransformRun, `/api/transform/run/${String(runId)}`),
    (value) => TERMINAL_STATUSES.has(value.status),
    {
      timeoutMs,
      subject: `Run ${String(runId)} of transform ${String(id)}`,
      recheck: `{action: "get_run", id: ${String(runId)}}`,
    },
  );

  if (FAILURE_STATUSES.has(final.status)) {
    const detail = final.message === null ? "" : ` Metabase reported: ${final.message}`;
    throw new TeachingError(
      `Run ${String(runId)} of transform ${String(id)} ${final.status}.${detail} Fix the transform's source with \`transform_write\` and run it again — a re-run of the same body fails the same way.`,
    );
  }

  const outcome: RunOutcome = { run_id: runId, status: final.status, message: final.message };
  if (!syncTarget) {
    return jsonResult(`run ${String(runId)} ${final.status}`, outcome);
  }

  const targetTableId = await awaitTargetTableId(deps.client, id, timeoutMs);
  outcome.target_table_id = targetTableId;
  const label =
    targetTableId === null
      ? `run ${String(runId)} ${final.status}, but its output table is not registered in Metabase yet — re-run with \`sync: true\` once the sync lands, or find the table with \`browse_data\``
      : `run ${String(runId)} ${final.status} — output is table ${String(targetTableId)}`;
  return jsonResult(label, outcome);
}

// A successful run registers its own output table, so the wait is on Metabase's own metadata
// catching up, not on a sync the caller has to trigger. Returns null on timeout: the run succeeded,
// which is the fact the caller asked for; the table id is the bonus that has not landed yet.
async function awaitTargetTableId(
  client: Client,
  transformId: number,
  timeoutMs: number,
): Promise<number | null> {
  try {
    const linked = await pollUntil(
      async () => client.requestParsed(Transform, `/api/transform/${String(transformId)}`),
      (transform) => linkedTableId(transform) !== null,
      {
        timeoutMs,
        subject: `The output table of transform ${String(transformId)}`,
        recheck: `{action: "run", id: ${String(transformId)}}`,
      },
    );
    return linkedTableId(linked);
  } catch (error) {
    if (error instanceof TeachingError) {
      return null;
    }
    throw error;
  }
}

function linkedTableId(transform: Transform): number | null {
  return transform.target_table_id ?? transform.table?.id ?? null;
}

async function listRuns(
  deps: MetabaseToolDeps,
  params: TransformRunParams,
  format: ResponseFormat,
): Promise<TextToolResult> {
  const items = await collectPaginated(deps.client, "/api/transform/run", TransformRun, {
    query: { "transform-ids": params.transform_id },
    ...(params.limit !== undefined && { max: params.limit }),
  });
  const envelope = buildListEnvelope(
    items.map((item) => project(item, TransformRunCompact, format)),
    {
      steering: {
        noun: "transform runs",
        narrowWith: ["transform_id"],
        pageWith: "limit",
      },
      total: items.length,
    },
  );
  return listResult("transform runs", envelope, format);
}

function transformListResult(
  items: readonly Transform[],
  format: ResponseFormat,
  context: string,
): TextToolResult {
  const envelope = buildListEnvelope(
    items.map((item) => project(item, TransformCompact, format)),
    { steering: { noun: "transforms", context }, total: items.length },
  );
  return listResult("transforms", envelope, format);
}

function project<T>(value: T, compact: z.ZodType<unknown>, format: ResponseFormat): unknown {
  return format === "detailed" ? value : compact.parse(value);
}

function requireId(params: TransformRunParams, what: string): number {
  if (params.id === undefined) {
    throw new TeachingError(`\`${params.action}\` needs \`id\` — ${what}.`);
  }
  return params.id;
}
