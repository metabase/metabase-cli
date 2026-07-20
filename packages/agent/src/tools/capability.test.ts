import { expect, test } from "vitest";
import type { InstanceContext } from "../metabase/probe";
import { UNKNOWN_INSTANCE } from "../metabase/probe";
import { assertCapabilities, capabilityGap, supportsCapabilities } from "./capability";
import { fakeClient, type Responder } from "./fake-client";
import { metabaseTools } from "./index";
import { TeachingError } from "./teaching-error";

const TRANSFORMS = { minVersion: 59 } as const;
const GIT_SYNC = { minVersion: 60, tokenFeature: "remote_sync" } as const;

function instance(majorVersion: number, tokenFeatures: string[]): InstanceContext {
  return {
    url: "https://mb.example.com",
    versionTag: `v1.${String(majorVersion)}.0`,
    majorVersion,
    edition: "enterprise",
    tokenFeatures,
    user: null,
  };
}

const notCalled: Responder = () => {
  throw new Error("client should not be called");
};

function toolNames(context: InstanceContext): string[] {
  const { client } = fakeClient(notCalled);
  return metabaseTools({ client, cwd: "/tmp", instance: context })
    .map((tool) => tool.name)
    .toSorted();
}

test("a version below the minimum is a gap naming both versions", () => {
  expect(capabilityGap(instance(58, []), TRANSFORMS)).toBe(
    "needs Metabase v59 or newer; this instance is v1.58.0",
  );
});

test("a missing token feature is a gap naming the feature", () => {
  expect(capabilityGap(instance(61, ["transforms"]), GIT_SYNC)).toBe(
    "needs the `remote_sync` paid feature, which this instance does not have enabled",
  );
});

test("a satisfied requirement has no gap", () => {
  expect(capabilityGap(instance(61, ["remote_sync"]), GIT_SYNC)).toBeNull();
});

test("an unprobed instance refutes nothing, so every tool stays available", () => {
  expect(supportsCapabilities(UNKNOWN_INSTANCE, GIT_SYNC)).toBe(true);
  expect(toolNames(UNKNOWN_INSTANCE)).toContain("git_sync");
});

test("assertCapabilities throws a TeachingError naming the tool and the gap", () => {
  expect(() => assertCapabilities(instance(58, []), TRANSFORMS, "transform_write")).toThrow(
    new TeachingError(
      "`transform_write` needs Metabase v59 or newer; this instance is v1.58.0. There is no workaround from this session.",
    ),
  );
});

test("a v58 instance is offered neither the transform tools nor git_sync", () => {
  const names = toolNames(instance(58, []));

  expect(names).toEqual([
    "browse_collection",
    "browse_data",
    "collection_write",
    "dashboard_write",
    "document_write",
    "duplicate_content",
    "execute_query",
    "execute_sql",
    "get_content",
    "get_parameter_values",
    "instance_settings",
    "measure_write",
    "metadata_write",
    "question_write",
    "run_saved_question",
    "search",
    "segment_write",
    "snippet_write",
    "timeline_write",
    "upload_csv",
  ]);
});

test("a v61 EE instance with remote_sync is offered the whole catalog", () => {
  const names = toolNames(instance(61, ["remote_sync", "transforms", "library"]));

  expect(names).toEqual([
    "browse_collection",
    "browse_data",
    "collection_write",
    "dashboard_write",
    "document_write",
    "duplicate_content",
    "execute_query",
    "execute_sql",
    "get_content",
    "get_parameter_values",
    "git_sync",
    "instance_settings",
    "library",
    "measure_write",
    "metadata_write",
    "question_write",
    "run_saved_question",
    "search",
    "segment_write",
    "snippet_write",
    "timeline_write",
    "transform_job_write",
    "transform_run",
    "transform_write",
    "upload_csv",
  ]);
});
