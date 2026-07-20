import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DeleteResult } from "../../src/commands/delete-runtime";
import { TimelineEventListEnvelope } from "../../src/commands/timeline/events";
import { TimelineListEnvelope } from "../../src/commands/timeline/list";
import {
  TimelineCompact,
  type TimelineCreateInput,
  type TimelineEventCreateInput,
} from "../../src/domain/timeline";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorMessage } from "./cli-error";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";

const FIRST_TIMELINE_ID = 1;
const TIMELINE_NAME = "Releases";
const TIMELINE_DESCRIPTION = "Product release milestones.";

const NEW_TIMELINE_COMPACT = {
  id: FIRST_TIMELINE_ID,
  name: TIMELINE_NAME,
  description: TIMELINE_DESCRIPTION,
  icon: "star",
  collection_id: null,
  default: false,
  archived: false,
} as const;

const NEW_TIMELINE_BODY: TimelineCreateInput = {
  name: TIMELINE_NAME,
  description: TIMELINE_DESCRIPTION,
};

const FIRST_EVENT_ID = 1;
const SECOND_EVENT_ID = 2;
const FIRST_EVENT_TIMESTAMP = "2026-05-04T10:00:00Z";
const SECOND_EVENT_TIMESTAMP = "2026-06-01T00:00:00Z";

describe("timeline e2e", () => {
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
      stdin: JSON.stringify(NEW_TIMELINE_BODY),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
  }

  async function createEvent(name: string, timestamp: string): Promise<void> {
    const body: TimelineEventCreateInput = {
      name,
      timestamp,
      timezone: "UTC",
      time_matters: false,
      timeline_id: FIRST_TIMELINE_ID,
    };
    const result = await runCli({
      args: ["timeline-event", "create", "--json"],
      stdin: JSON.stringify(body),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
  }

  it("list returns an empty envelope on a fresh restore", async () => {
    const result = await runCli({
      args: ["timeline", "list", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TimelineListEnvelope)).toEqual({
      data: [],
      returned: 0,
      total: 0,
    });
  });

  it("create returns the timeline in compact form with server defaults applied", async () => {
    const result = await runCli({
      args: ["timeline", "create", "--json"],
      stdin: JSON.stringify(NEW_TIMELINE_BODY),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TimelineCompact)).toEqual(NEW_TIMELINE_COMPACT);
  });

  it("create with an unknown icon fails on Zod validation", async () => {
    const result = await runCli({
      args: ["timeline", "create", "--json"],
      stdin: JSON.stringify({ name: "bad icon", icon: "balloons" }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("request body: value did not match expected schema");
    expect(result.stdout).toBe("");
  });

  it("create + list shows the new timeline via the compact projection", async () => {
    await createTimeline();

    const result = await runCli({
      args: ["timeline", "list", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TimelineListEnvelope)).toEqual({
      data: [NEW_TIMELINE_COMPACT],
      returned: 1,
      total: 1,
    });
  });

  it("get returns the timeline by id in compact form", async () => {
    await createTimeline();

    const result = await runCli({
      args: ["timeline", "get", String(FIRST_TIMELINE_ID), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TimelineCompact)).toEqual(NEW_TIMELINE_COMPACT);
  });

  it("get with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["timeline", "get", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("get against a missing timeline id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["timeline", "get", "9999999", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Not found: GET /api/timeline/9999999.");
  });

  it("update renames the timeline and the compact view reflects the new name", async () => {
    await createTimeline();

    const result = await runCli({
      args: ["timeline", "update", String(FIRST_TIMELINE_ID), "--json"],
      stdin: JSON.stringify({ name: "Product releases" }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TimelineCompact)).toEqual({
      ...NEW_TIMELINE_COMPACT,
      name: "Product releases",
    });
  });

  it("archive flips archived and list only shows it under --archived", async () => {
    await createTimeline();

    const archiveResult = await runCli({
      args: ["timeline", "archive", String(FIRST_TIMELINE_ID), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(archiveResult.exitCode, archiveResult.stderr).toBe(0);
    expect(parseJson(archiveResult.stdout, TimelineCompact)).toEqual({
      ...NEW_TIMELINE_COMPACT,
      archived: true,
    });

    const activeList = await runCli({
      args: ["timeline", "list", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(activeList.exitCode, activeList.stderr).toBe(0);
    expect(parseJson(activeList.stdout, TimelineListEnvelope)).toEqual({
      data: [],
      returned: 0,
      total: 0,
    });

    const archivedList = await runCli({
      args: ["timeline", "list", "--archived", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(archivedList.exitCode, archivedList.stderr).toBe(0);
    expect(parseJson(archivedList.stdout, TimelineListEnvelope)).toEqual({
      data: [{ ...NEW_TIMELINE_COMPACT, archived: true }],
      returned: 1,
      total: 1,
    });
  });

  it("archive cascades archived to the timeline's events", async () => {
    await createTimeline();
    await createEvent("v2 launch", FIRST_EVENT_TIMESTAMP);

    const archiveResult = await runCli({
      args: ["timeline", "archive", String(FIRST_TIMELINE_ID), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(archiveResult.exitCode, archiveResult.stderr).toBe(0);

    const eventsResult = await runCli({
      args: ["timeline", "events", String(FIRST_TIMELINE_ID), "--archived", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(eventsResult.exitCode, eventsResult.stderr).toBe(0);
    expect(parseJson(eventsResult.stdout, TimelineEventListEnvelope)).toEqual({
      data: [
        {
          id: FIRST_EVENT_ID,
          name: "v2 launch",
          description: null,
          timestamp: FIRST_EVENT_TIMESTAMP,
          icon: "star",
          timeline_id: FIRST_TIMELINE_ID,
          archived: true,
        },
      ],
      returned: 1,
      total: 1,
    });
  });

  it("events returns an empty envelope for a timeline with no events", async () => {
    await createTimeline();

    const result = await runCli({
      args: ["timeline", "events", String(FIRST_TIMELINE_ID), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TimelineEventListEnvelope)).toEqual({
      data: [],
      returned: 0,
      total: 0,
    });
  });

  it("events lists unarchived events by default and includes archived ones with --archived", async () => {
    await createTimeline();
    await createEvent("v2 launch", FIRST_EVENT_TIMESTAMP);
    await createEvent("v3 launch", SECOND_EVENT_TIMESTAMP);

    const archiveEvent = await runCli({
      args: ["timeline-event", "archive", String(SECOND_EVENT_ID), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(archiveEvent.exitCode, archiveEvent.stderr).toBe(0);

    const activeCompact = {
      id: FIRST_EVENT_ID,
      name: "v2 launch",
      description: null,
      timestamp: FIRST_EVENT_TIMESTAMP,
      icon: "star",
      timeline_id: FIRST_TIMELINE_ID,
      archived: false,
    };
    const archivedCompact = {
      id: SECOND_EVENT_ID,
      name: "v3 launch",
      description: null,
      timestamp: SECOND_EVENT_TIMESTAMP,
      icon: "star",
      timeline_id: FIRST_TIMELINE_ID,
      archived: true,
    };

    const activeResult = await runCli({
      args: ["timeline", "events", String(FIRST_TIMELINE_ID), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(activeResult.exitCode, activeResult.stderr).toBe(0);
    expect(parseJson(activeResult.stdout, TimelineEventListEnvelope)).toEqual({
      data: [activeCompact],
      returned: 1,
      total: 1,
    });

    const allResult = await runCli({
      args: ["timeline", "events", String(FIRST_TIMELINE_ID), "--archived", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(allResult.exitCode, allResult.stderr).toBe(0);
    const allEnvelope = parseJson(allResult.stdout, TimelineEventListEnvelope);
    expect({
      ...allEnvelope,
      data: [...allEnvelope.data].toSorted((left, right) => left.id - right.id),
    }).toEqual({
      data: [activeCompact, archivedCompact],
      returned: 2,
      total: 2,
    });
  });

  it("events with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["timeline", "events", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("delete --yes hard-deletes the timeline; subsequent get 404s", async () => {
    await createTimeline();

    const deleteResult = await runCli({
      args: ["timeline", "delete", String(FIRST_TIMELINE_ID), "--yes", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(deleteResult.exitCode, deleteResult.stderr).toBe(0);
    expect(parseJson(deleteResult.stdout, DeleteResult)).toEqual({
      deleted: true,
      aborted: false,
      id: FIRST_TIMELINE_ID,
    });

    const getResult = await runCli({
      args: ["timeline", "get", String(FIRST_TIMELINE_ID), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(getResult.exitCode).toBe(1);
    expect(getResult.stderr).toContain(`Not found: GET /api/timeline/${FIRST_TIMELINE_ID}.`);
  });

  it("delete without --yes refuses in non-TTY and exits 2 (explicit confirmation required)", async () => {
    await createTimeline();

    const result = await runCli({
      args: ["timeline", "delete", String(FIRST_TIMELINE_ID), "--json"],
      stdin: "",
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      `refusing to delete ${FIRST_TIMELINE_ID} without confirmation — pass --yes to proceed non-interactively`,
    );
    expect(result.stdout).toBe("");
  });
});
