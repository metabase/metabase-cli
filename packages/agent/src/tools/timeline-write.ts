import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  Timeline,
  TimelineCompact,
  TimelineCreateInput,
  TimelineEvent,
  TimelineEventCompact,
  TimelineEventCreateInput,
  TimelineEventUpdateInput,
  TimelineUpdateInput,
} from "@metabase/cli/domain";
import { type Static, Type } from "typebox";
import type { MetabaseToolDeps } from "./deps";
import { TeachingError } from "./teaching-error";
import { guardTool, jsonResult, type TextToolResult } from "./tool-result";
import { assertMethodRequirements, deletableMethodSchema } from "./write-recipe";

const ENTITIES = ["timeline", "event"] as const;
type Entity = (typeof ENTITIES)[number];

const ICONS = ["star", "cake", "mail", "warning", "bell", "cloud"] as const;

const parameters = Type.Object({
  method: deletableMethodSchema,
  entity: Type.Unsafe<Entity>({
    type: "string",
    enum: [...ENTITIES],
    description:
      "`timeline` is the named track events hang on (a collection has one or more); `event` is a dated point on one. An event needs a timeline to live on, so create the timeline first.",
  }),
  id: Type.Optional(
    Type.Integer({
      description:
        "The timeline id or the event id, per `entity`. Required for `update` and `delete`.",
    }),
  ),
  name: Type.Optional(Type.String({ description: "Name. Required for `create`." })),
  description: Type.Optional(Type.String()),
  icon: Type.Optional(
    Type.Unsafe<(typeof ICONS)[number]>({
      type: "string",
      enum: [...ICONS],
      description: "The marker shown on charts. Defaults to `star`.",
    }),
  ),
  collection_id: Type.Optional(
    Type.Integer({
      description:
        "`timeline` only: the collection it belongs to. Its events then show on charts built from that collection's questions. Omit for the root collection.",
    }),
  ),
  timeline_id: Type.Optional(
    Type.Integer({
      description: "`event` only: the timeline it hangs on. Required to create one.",
    }),
  ),
  timestamp: Type.Optional(
    Type.String({
      description:
        '`event` only: when it happened, as ISO 8601 — `"2024-03-01T00:00:00Z"`. Required to create one.',
    }),
  ),
  timezone: Type.Optional(
    Type.String({
      description:
        '`event` only: the timestamp\'s timezone, e.g. `"UTC"` or `"Europe/Berlin"`. Defaults to `"UTC"`.',
    }),
  ),
  time_matters: Type.Optional(
    Type.Boolean({
      description:
        "`event` only: `true` when the time of day is meaningful (a deploy at 14:32), `false` when only the date is (a launch on the 1st). Required to create an event — the server has no default and rejects an event without it.",
    }),
  ),
  default: Type.Optional(
    Type.Boolean({
      description: "`timeline` only: make it the collection's default timeline.",
    }),
  ),
  archived: Type.Optional(
    Type.Boolean({ description: "`update` only: `true` archives, `false` restores." }),
  ),
});

export function timelineWriteTool(deps: MetabaseToolDeps): ToolDefinition {
  return defineTool({
    name: "timeline_write",
    label: "Write timeline",
    description:
      'Create, update or delete timelines and the events on them — the dated markers Metabase draws over time-series charts, so a dip in the data sits next to the release, outage or campaign that explains it. Read them back with `get_content`.\n\nExamples: `{method: "create", entity: "timeline", name: "Releases", collection_id: 5}` · `{method: "create", entity: "event", timeline_id: 2, name: "v3 launch", timestamp: "2024-03-01T00:00:00Z", time_matters: false}`',
    parameters,
    execute: (_id, params) => runTimelineWriteTool(deps, params),
  });
}

type TimelineWriteParams = Static<typeof parameters>;

const DEFAULT_TIMEZONE = "UTC";

export function runTimelineWriteTool(
  deps: MetabaseToolDeps,
  params: TimelineWriteParams,
): Promise<TextToolResult> {
  return guardTool(async () => {
    if (params.entity === "event") {
      return await writeEvent(deps, params);
    }
    return await writeTimeline(deps, params);
  });
}

async function writeTimeline(
  deps: MetabaseToolDeps,
  params: TimelineWriteParams,
): Promise<TextToolResult> {
  assertMethodRequirements(params.method, params, {
    create: ["name"],
    update: ["id"],
    delete: ["id"],
  });

  if (params.method === "delete") {
    const id = requireId(params.id);
    await deps.client.requestRaw(`/api/timeline/${String(id)}`, {
      method: "DELETE",
      expectContentType: "binary",
    });
    return jsonResult(`deleted timeline ${String(id)} and every event on it`, {
      id,
      deleted: true,
    });
  }

  const fields = {
    name: params.name,
    description: params.description,
    icon: params.icon,
    collection_id: params.collection_id,
    default: params.default,
  };

  if (params.method === "create") {
    const created = await deps.client.requestParsed(Timeline, "/api/timeline", {
      method: "POST",
      body: TimelineCreateInput.parse(fields),
    });
    return jsonResult(`created timeline ${String(created.id)}`, TimelineCompact.parse(created));
  }

  const updated = await deps.client.requestParsed(Timeline, `/api/timeline/${String(params.id)}`, {
    method: "PUT",
    body: TimelineUpdateInput.parse({ ...fields, archived: params.archived }),
  });
  return jsonResult(`updated timeline ${String(updated.id)}`, TimelineCompact.parse(updated));
}

async function writeEvent(
  deps: MetabaseToolDeps,
  params: TimelineWriteParams,
): Promise<TextToolResult> {
  assertMethodRequirements(params.method, params, {
    create: ["name", "timeline_id", "timestamp", "time_matters"],
    update: ["id"],
    delete: ["id"],
  });

  if (params.method === "delete") {
    const id = requireId(params.id);
    await deps.client.requestRaw(`/api/timeline-event/${String(id)}`, {
      method: "DELETE",
      expectContentType: "binary",
    });
    return jsonResult(`deleted event ${String(id)}`, { id, deleted: true });
  }

  const fields = {
    name: params.name,
    description: params.description,
    icon: params.icon,
    timeline_id: params.timeline_id,
    timestamp: params.timestamp,
    time_matters: params.time_matters,
  };

  if (params.method === "create") {
    const created = await deps.client.requestParsed(TimelineEvent, "/api/timeline-event", {
      method: "POST",
      body: TimelineEventCreateInput.parse({
        ...fields,
        timezone: params.timezone ?? DEFAULT_TIMEZONE,
      }),
    });
    return jsonResult(`created event ${String(created.id)}`, TimelineEventCompact.parse(created));
  }

  const updated = await deps.client.requestParsed(
    TimelineEvent,
    `/api/timeline-event/${String(params.id)}`,
    {
      method: "PUT",
      body: TimelineEventUpdateInput.parse({
        ...fields,
        timezone: params.timezone,
        archived: params.archived,
      }),
    },
  );
  return jsonResult(`updated event ${String(updated.id)}`, TimelineEventCompact.parse(updated));
}

function requireId(id: number | undefined): number {
  if (id === undefined) {
    throw new TeachingError("id is required for delete method");
  }
  return id;
}
