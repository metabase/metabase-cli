import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DeleteResult } from "../../src/commands/delete-runtime";
import {
  TimelineEventCompact,
  type TimelineCreateInput,
  type TimelineEventCreateInput,
} from "../../src/domain/timeline";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorMessage } from "./cli-error";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";

const TIMELINE_ID = 1;
const FIRST_EVENT_ID = 1;
const EVENT_NAME = "v2 launch";
const EVENT_TIMESTAMP = "2026-05-04T10:00:00Z";

const TIMELINE_BODY: TimelineCreateInput = {
  name: "Releases",
  icon: "cake",
};

const NEW_EVENT_BODY: TimelineEventCreateInput = {
  name: EVENT_NAME,
  timestamp: EVENT_TIMESTAMP,
  timezone: "UTC",
  time_matters: false,
  timeline_id: TIMELINE_ID,
};

const NEW_EVENT_COMPACT = {
  id: FIRST_EVENT_ID,
  name: EVENT_NAME,
  description: null,
  timestamp: EVENT_TIMESTAMP,
  icon: "cake",
  timeline_id: TIMELINE_ID,
  archived: false,
} as const;

describe("timeline-event e2e", () => {
  let bootstrap: E2EBootstrap;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    bootstrap = await readBootstrap();
  });

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function makeIsolatedConfigHome(): Promise<string> {
    const dir = await mkTempConfigHome();
    tempDirs.push(dir);
    return dir;
  }

  function authEnv(): Record<string, string> {
    return {
      MB_URL: bootstrap.baseUrl,
      MB_API_KEY: bootstrap.adminApiKey,
    };
  }

  async function createTimeline(): Promise<void> {
    const result = await runCli({
      args: ["timeline", "create", "--json"],
      stdin: JSON.stringify(TIMELINE_BODY),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
  }

  async function createEvent(): Promise<void> {
    const result = await runCli({
      args: ["timeline-event", "create", "--json"],
      stdin: JSON.stringify(NEW_EVENT_BODY),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
  }

  it("create returns the event in compact form, inheriting the timeline's icon", async () => {
    await createTimeline();

    const result = await runCli({
      args: ["timeline-event", "create", "--json"],
      stdin: JSON.stringify(NEW_EVENT_BODY),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TimelineEventCompact)).toEqual(NEW_EVENT_COMPACT);
  });

  it("create with a body missing required fields fails on Zod validation", async () => {
    const result = await runCli({
      args: ["timeline-event", "create", "--json"],
      stdin: JSON.stringify({ name: "missing timestamp, timezone, timeline_id" }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("request body: value did not match expected schema");
    expect(result.stdout).toBe("");
  });

  it("create against a missing timeline surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["timeline-event", "create", "--json"],
      stdin: JSON.stringify({ ...NEW_EVENT_BODY, timeline_id: 9999999 }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    // The server sends this 404 as text/plain ("Timeline with id … not found"), which the
    // CLI's route-missing heuristic currently misreads as a missing endpoint; fixing that
    // belongs in the HTTP error classifier, at which point this assertion should become
    // the resource-missing message.
    expect(result.stderr).toContain(
      "This endpoint is not available on the connected Metabase: POST /api/timeline-event.",
    );
    expect(result.stdout).toBe("");
  });

  it("get returns the event by id in compact form", async () => {
    await createTimeline();
    await createEvent();

    const result = await runCli({
      args: ["timeline-event", "get", String(FIRST_EVENT_ID), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TimelineEventCompact)).toEqual(NEW_EVENT_COMPACT);
  });

  it("get with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["timeline-event", "get", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("get against a missing event id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["timeline-event", "get", "9999999", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Not found: GET /api/timeline-event/9999999.");
  });

  it("update renames the event and the compact view reflects the new name", async () => {
    await createTimeline();
    await createEvent();

    const result = await runCli({
      args: ["timeline-event", "update", String(FIRST_EVENT_ID), "--json"],
      stdin: JSON.stringify({ name: "v2.1 launch" }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TimelineEventCompact)).toEqual({
      ...NEW_EVENT_COMPACT,
      name: "v2.1 launch",
    });
  });

  it("update with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["timeline-event", "update", "abc", "--json"],
      stdin: JSON.stringify({ name: "x" }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("archive flips archived from false to true", async () => {
    await createTimeline();
    await createEvent();

    const result = await runCli({
      args: ["timeline-event", "archive", String(FIRST_EVENT_ID), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TimelineEventCompact)).toEqual({
      ...NEW_EVENT_COMPACT,
      archived: true,
    });
  });

  it("delete --yes removes the event; subsequent get 404s", async () => {
    await createTimeline();
    await createEvent();

    const deleteResult = await runCli({
      args: ["timeline-event", "delete", String(FIRST_EVENT_ID), "--yes", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(deleteResult.exitCode, deleteResult.stderr).toBe(0);
    expect(parseJson(deleteResult.stdout, DeleteResult)).toEqual({
      deleted: true,
      aborted: false,
      id: FIRST_EVENT_ID,
    });

    const getResult = await runCli({
      args: ["timeline-event", "get", String(FIRST_EVENT_ID), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(getResult.exitCode).toBe(1);
    expect(getResult.stderr).toContain(`Not found: GET /api/timeline-event/${FIRST_EVENT_ID}.`);
  });

  it("delete without --yes refuses in non-TTY and exits 2 (explicit confirmation required)", async () => {
    await createTimeline();
    await createEvent();

    const result = await runCli({
      args: ["timeline-event", "delete", String(FIRST_EVENT_ID), "--json"],
      stdin: "",
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      `refusing to delete ${FIRST_EVENT_ID} without confirmation — pass --yes to proceed non-interactively`,
    );
    expect(result.stdout).toBe("");
  });
});
