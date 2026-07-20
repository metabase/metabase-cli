import { expect, test } from "vitest";
import type { InstanceContext } from "../metabase/probe";
import { type Responder, toolDeps } from "./fake-client";
import { TeachingError } from "./teaching-error";
import { runTransformJobWriteTool } from "./transform-job-write";

const EE_59: InstanceContext = {
  url: "https://mb.example.com",
  versionTag: "v1.59.0",
  majorVersion: 59,
  edition: "enterprise",
  tokenFeatures: ["transforms"],
  user: null,
};

const JOB: Responder = (path) => {
  if (path === "/api/transform-tag") {
    return [{ id: 7, name: "nightly", entity_id: "e", built_in_type: null }];
  }
  return {
    id: 2,
    name: "Nightly",
    description: null,
    schedule: "0 0 0 * * ?",
    ui_display_type: "cron/raw",
    active: true,
    entity_id: "e",
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    built_in_type: null,
    tag_ids: [7],
  };
};

test("creating a job posts the cron schedule and the resolved tag ids", async () => {
  const { deps, requests } = toolDeps(JOB, "/tmp", EE_59);

  const result = await runTransformJobWriteTool(deps, {
    method: "create",
    name: "Nightly",
    schedule: "0 0 0 * * ?",
    tags: ["nightly"],
  });

  expect(requests).toEqual([
    { path: "/api/transform-tag", method: "GET", options: undefined },
    {
      path: "/api/transform-job",
      method: "POST",
      options: {
        method: "POST",
        body: { name: "Nightly", schedule: "0 0 0 * * ?", tag_ids: [7] },
      },
    },
  ]);
  expect(result.details).toEqual({
    kind: "json",
    label: "created job 2",
    noun: "transform job",
    value: {
      id: 2,
      name: "Nightly",
      description: null,
      schedule: "0 0 0 * * ?",
      ui_display_type: "cron/raw",
      active: true,
      built_in_type: null,
    },
  });
});

test("a 5-field Unix cron is refused before the request, with the 6-field form named", async () => {
  const { deps, requests } = toolDeps(JOB, "/tmp", EE_59);

  await expect(
    runTransformJobWriteTool(deps, { method: "create", name: "Nightly", schedule: "0 0 * * *" }),
  ).rejects.toThrow(
    new TeachingError(
      '`schedule` takes a 6-field Quartz cron (seconds minutes hours day-of-month month day-of-week, plus an optional year); "0 0 * * *" has 5. A Unix 5-field expression is one field short — prefix it with the seconds field, e.g. "0 0 0 * * ?" for nightly at midnight.',
    ),
  );
  expect(requests).toEqual([]);
});

// Metabase's own built-in jobs are scheduled `0 0 * * * ? *` — Quartz's optional year field. A
// validator that took 6 fields as the only legal shape would reject the server's own vocabulary.
test("a 7-field cron carrying Quartz's optional year is accepted", async () => {
  const { deps, requests } = toolDeps(JOB, "/tmp", EE_59);

  await runTransformJobWriteTool(deps, {
    method: "create",
    name: "Hourly",
    schedule: "0 0 * * * ? *",
  });

  expect(requests).toEqual([
    {
      path: "/api/transform-job",
      method: "POST",
      options: { method: "POST", body: { name: "Hourly", schedule: "0 0 * * * ? *" } },
    },
  ]);
});

test("pausing a job is an update, not a delete", async () => {
  const { deps, requests } = toolDeps(JOB, "/tmp", EE_59);

  await runTransformJobWriteTool(deps, { method: "update", id: 2, active: false });

  expect(requests).toEqual([
    {
      path: "/api/transform-job/2",
      method: "PUT",
      options: { method: "PUT", body: { active: false } },
    },
  ]);
});

test("deleting a job says the transforms it ran survive it", async () => {
  const { deps, requests } = toolDeps(JOB, "/tmp", EE_59);

  const result = await runTransformJobWriteTool(deps, { method: "delete", id: 2 });

  expect(requests).toEqual([
    {
      path: "/api/transform-job/2",
      method: "DELETE",
      options: { method: "DELETE", expectContentType: "binary" },
    },
  ]);
  expect(result.details).toEqual({
    kind: "json",
    label: "deleted job 2 — the transforms it ran are untouched, and now run only when triggered",
    value: { id: 2, deleted: true },
  });
});
