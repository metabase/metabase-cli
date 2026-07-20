import { expect, test } from "vitest";
import { type Responder, toolDeps } from "./fake-client";
import { TeachingError } from "./teaching-error";
import { runTimelineWriteTool } from "./timeline-write";

const TIMELINE: Responder = () => ({
  id: 2,
  name: "Releases",
  description: null,
  icon: "star",
  collection_id: 5,
  archived: false,
  default: false,
  creator_id: 1,
  entity_id: "e",
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
});

const EVENT: Responder = () => ({
  id: 8,
  name: "v3 launch",
  description: null,
  timestamp: "2026-03-01T00:00:00Z",
  timezone: "UTC",
  time_matters: false,
  icon: "star",
  timeline_id: 2,
  archived: false,
  creator_id: 1,
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
});

test("creating a timeline files it in a collection", async () => {
  const { deps, requests } = toolDeps(TIMELINE);

  const result = await runTimelineWriteTool(deps, {
    method: "create",
    entity: "timeline",
    name: "Releases",
    collection_id: 5,
  });

  expect(requests).toEqual([
    {
      path: "/api/timeline",
      method: "POST",
      options: { method: "POST", body: { name: "Releases", collection_id: 5 } },
    },
  ]);
  expect(result.details).toEqual({
    kind: "json",
    label: "created timeline 2",
    value: {
      id: 2,
      name: "Releases",
      description: null,
      icon: "star",
      collection_id: 5,
      default: false,
      archived: false,
    },
  });
});

test("an event defaults to UTC and carries time_matters, which the server has no default for", async () => {
  const { deps, requests } = toolDeps(EVENT);

  const result = await runTimelineWriteTool(deps, {
    method: "create",
    entity: "event",
    name: "v3 launch",
    timeline_id: 2,
    timestamp: "2026-03-01T00:00:00Z",
    time_matters: false,
  });

  expect(requests).toEqual([
    {
      path: "/api/timeline-event",
      method: "POST",
      options: {
        method: "POST",
        body: {
          name: "v3 launch",
          timeline_id: 2,
          timestamp: "2026-03-01T00:00:00Z",
          time_matters: false,
          timezone: "UTC",
        },
      },
    },
  ]);
  expect(result.details).toEqual({
    kind: "json",
    label: "created event 8",
    value: {
      id: 8,
      name: "v3 launch",
      description: null,
      timestamp: "2026-03-01T00:00:00Z",
      icon: "star",
      timeline_id: 2,
      archived: false,
    },
  });
});

test("an event without time_matters is refused before the request that would 500", async () => {
  const { deps, requests } = toolDeps(EVENT);

  await expect(
    runTimelineWriteTool(deps, {
      method: "create",
      entity: "event",
      name: "v3 launch",
      timeline_id: 2,
      timestamp: "2026-03-01T00:00:00Z",
    }),
  ).rejects.toThrow(
    new TeachingError(
      "`time_matters` is required for the `create` method. This call carried `method`, `entity`, `name`, `timeline_id`, `timestamp` and nothing else.",
    ),
  );
  expect(requests).toEqual([]);
});

test("deleting a timeline takes its events with it", async () => {
  const { deps, requests } = toolDeps(TIMELINE);

  const result = await runTimelineWriteTool(deps, { method: "delete", entity: "timeline", id: 2 });

  expect(requests).toEqual([
    {
      path: "/api/timeline/2",
      method: "DELETE",
      options: { method: "DELETE", expectContentType: "binary" },
    },
  ]);
  expect(result.details).toEqual({
    kind: "json",
    label: "deleted timeline 2 and every event on it",
    value: { id: 2, deleted: true },
  });
});
