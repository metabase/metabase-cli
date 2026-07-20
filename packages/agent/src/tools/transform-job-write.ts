import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  TransformJob,
  TransformJobCompact,
  TransformJobCreateInput,
  TransformJobUpdateInput,
} from "@metabase/cli/domain";
import { type Static, Type } from "typebox";
import { assertCapabilities } from "./capability";
import type { MetabaseToolDeps } from "./deps";
import { TeachingError } from "./teaching-error";
import { entityResult, guardTool, jsonResult, type TextToolResult } from "./tool-result";
import { resolveTagIds } from "./transform-tags";
import { TRANSFORM_CAPABILITIES } from "./transform-write";
import { assertMethodRequirements, deletableMethodSchema } from "./write-recipe";

const TOOL_NAME = "transform_job_write";
const CRON_FIELDS = 6;
const CRON_FIELDS_WITH_YEAR = 7;

const parameters = Type.Object({
  method: deletableMethodSchema,
  id: Type.Optional(Type.Integer({ description: "Job id. Required for `update` and `delete`." })),
  name: Type.Optional(Type.String({ description: "Job name. Required for `create`." })),
  description: Type.Optional(Type.String()),
  schedule: Type.Optional(
    Type.String({
      description:
        'A 6-field Quartz cron expression — `seconds minutes hours day-of-month month day-of-week` — in the instance\'s report timezone. Nightly at midnight is `"0 0 0 * * ?"`; hourly on the hour is `"0 0 * * * ?"`; every Monday at 07:00 is `"0 0 7 ? * MON"`. Quartz forbids naming both day-of-month and day-of-week, so exactly one of those two fields is `?`. Required for `create`.',
    }),
  ),
  tags: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Tag names. The job runs every transform carrying one of these tags, plus those transforms' dependencies — a job with no tags runs nothing. Names that do not exist yet are created. Passing `tags` replaces the job's whole tag set.",
    }),
  ),
  active: Type.Optional(
    Type.Boolean({
      description: "`update` only: `false` pauses the schedule without deleting the job.",
    }),
  ),
});

export function transformJobWriteTool(deps: MetabaseToolDeps): ToolDefinition {
  return defineTool({
    name: TOOL_NAME,
    label: "Write transform job",
    description:
      'Create, update or delete a transform job — the schedule that runs transforms unattended. A job does not name transforms: it carries tags, and it runs every transform tagged with one of them, so tagging a transform (`transform_write` with `tags`) is what puts it on a schedule.\n\nExamples: `{method: "create", name: "Nightly", schedule: "0 0 0 * * ?", tags: ["nightly"]}` · `{method: "update", id: 2, active: false}`',
    parameters,
    execute: (_id, params) => runTransformJobWriteTool(deps, params),
  });
}

type TransformJobWriteParams = Static<typeof parameters>;

export function runTransformJobWriteTool(
  deps: MetabaseToolDeps,
  params: TransformJobWriteParams,
): Promise<TextToolResult> {
  return guardTool(async () => {
    assertCapabilities(deps.instance, TRANSFORM_CAPABILITIES, TOOL_NAME);
    assertMethodRequirements(params.method, params, {
      create: ["name", "schedule"],
      update: ["id"],
      delete: ["id"],
    });

    if (params.method === "delete") {
      const id = requireId(params.id);
      await deps.client.requestRaw(`/api/transform-job/${String(id)}`, {
        method: "DELETE",
        expectContentType: "binary",
      });
      return jsonResult(
        `deleted job ${String(id)} — the transforms it ran are untouched, and now run only when triggered`,
        { id, deleted: true },
      );
    }

    if (params.schedule !== undefined) {
      assertQuartzCron(params.schedule);
    }
    const tagIds =
      params.tags === undefined ? undefined : await resolveTagIds(deps.client, params.tags);
    const fields = {
      name: params.name,
      description: params.description,
      schedule: params.schedule,
      tag_ids: tagIds,
    };

    if (params.method === "create") {
      const created = await deps.client.requestParsed(TransformJob, "/api/transform-job", {
        method: "POST",
        body: TransformJobCreateInput.parse(fields),
      });
      return entityResult(
        "transform job",
        `created job ${String(created.id)}`,
        TransformJobCompact.parse(created),
      );
    }

    const updated = await deps.client.requestParsed(
      TransformJob,
      `/api/transform-job/${String(params.id)}`,
      { method: "PUT", body: TransformJobUpdateInput.parse({ ...fields, active: params.active }) },
    );
    return entityResult(
      "transform job",
      `updated job ${String(updated.id)}`,
      TransformJobCompact.parse(updated),
    );
  });
}

// Quartz is not Unix cron: it takes a leading seconds field (and an optional trailing year, which
// Metabase's own built-in jobs use), so the five-field expression every model knows produces a
// schedule one unit off rather than an error.
function assertQuartzCron(schedule: string): void {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length < CRON_FIELDS || fields.length > CRON_FIELDS_WITH_YEAR) {
    throw new TeachingError(
      `\`schedule\` takes a 6-field Quartz cron (seconds minutes hours day-of-month month day-of-week, plus an optional year); "${schedule}" has ${String(fields.length)}. A Unix 5-field expression is one field short — prefix it with the seconds field, e.g. "0 0 0 * * ?" for nightly at midnight.`,
    );
  }
}

function requireId(id: number | undefined): number {
  if (id === undefined) {
    throw new TeachingError("id is required for delete method");
  }
  return id;
}
