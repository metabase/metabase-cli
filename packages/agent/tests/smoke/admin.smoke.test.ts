import { Timeline, TimelineCreateInput, TimelineEvent } from "@metabase/cli/domain";
import { afterEach, expect, test } from "vitest";
import { z } from "zod";
import {
  AGENT_TIMEOUT_MS,
  type AgentRun,
  bashCommands,
  cleanupScratch,
  type Live,
  resolveLive,
  runAgent,
  toolNames,
} from "./live";

const EVENT_NAME = "Admin smoke";
const EVENT_DATE = "2024-03-01";

const TimelineWithEvents = Timeline.extend({ events: z.array(TimelineEvent) });

const live: Live | null = await resolveLive();
const transformsEnabled = live?.instance.tokenFeatures?.includes("transforms") === true;

afterEach(cleanupScratch);

test.skipIf(live === null)(
  "reads a setting through `instance_settings`",
  async () => {
    const siteUuid = await requireLive().connection.client.requestParsed(
      z.string(),
      "/api/setting/site-uuid",
    );

    const run = await runAgent(
      requireLive(),
      "What is the value of this Metabase instance's `site-uuid` setting? Reply with the value and nothing else.",
    );

    expect(toolNames(run)).toContain("instance_settings");
    expect(run.text).toContain(siteUuid);
    expectNoShellOut(run);
  },
  AGENT_TIMEOUT_MS,
);

test.skipIf(live === null || !transformsEnabled)(
  "lists transform jobs through `transform_run`",
  async () => {
    const run = await runAgent(requireLive(), "List this instance's transform jobs.");

    expect(toolNames(run)).toContain("transform_run");
    expectNoShellOut(run);
  },
  AGENT_TIMEOUT_MS,
);

test.skipIf(live === null)(
  "creates a timeline event through `timeline_write`",
  async () => {
    const timeline = await createTimeline();
    try {
      const run = await runAgent(
        requireLive(),
        `Add an event named "${EVENT_NAME}" dated ${EVENT_DATE} to the Metabase timeline with id ${timeline.id}.`,
      );

      expect(toolNames(run)).toContain("timeline_write");
      expectNoShellOut(run);
      const events = await readEvents(timeline.id);
      const created = events.filter((event) => event.name === EVENT_NAME);
      expect(created.map((event) => event.timestamp.slice(0, EVENT_DATE.length))).toEqual([
        EVENT_DATE,
      ]);
    } finally {
      await deleteTimeline(timeline.id);
    }
  },
  AGENT_TIMEOUT_MS,
);

// The curated tools are the agent's whole Metabase surface. A model that reaches the instance from
// bash — through a CLI the operator happens to have installed — runs under a credential this product
// does not own, and every such call is invisible to the tool layer.
function expectNoShellOut(run: AgentRun): void {
  expect(bashCommands(run).filter((command) => /\bmb\b/.test(command))).toEqual([]);
}

function requireLive(): Live {
  if (live === null) {
    throw new Error("The admin smoke needs a model key, MB_URL, and MB_API_KEY.");
  }
  return live;
}

async function createTimeline(): Promise<Timeline> {
  return requireLive().connection.client.requestParsed(Timeline, "/api/timeline", {
    method: "POST",
    body: TimelineCreateInput.parse({ name: "Admin smoke timeline", icon: "star" }),
  });
}

async function readEvents(timelineId: number): Promise<TimelineEvent[]> {
  const timeline = await requireLive().connection.client.requestParsed(
    TimelineWithEvents,
    `/api/timeline/${timelineId}`,
    { query: { include: "events" } },
  );
  return timeline.events;
}

async function deleteTimeline(timelineId: number): Promise<void> {
  await requireLive().connection.client.requestRaw(`/api/timeline/${timelineId}`, {
    method: "DELETE",
    expectContentType: "binary",
  });
}
