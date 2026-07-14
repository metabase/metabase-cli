import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { SubscriptionListEnvelope } from "../../src/commands/subscription/list";
import {
  PulseCompact,
  type PulseChannelCompact,
  type PulseCreateInput,
} from "../../src/domain/pulse";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorMessage } from "./cli-error";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { SEEDED } from "./seed/seeded";

const SUBSCRIPTION_NAME = "Weekly orders";
const RECIPIENT = "team@example.com";
const OTHER_DASHBOARD_ID = SEEDED.ordersDashboardId + 1000;

const NEW_SUBSCRIPTION_BODY: PulseCreateInput = {
  name: SUBSCRIPTION_NAME,
  dashboard_id: SEEDED.ordersDashboardId,
  cards: [
    {
      id: SEEDED.ordersCardId,
      dashboard_card_id: SEEDED.ordersDashcardId,
      include_csv: false,
      include_xls: false,
    },
  ],
  channels: [
    {
      channel_type: "email",
      enabled: true,
      schedule_type: "daily",
      schedule_hour: 8,
      recipients: [{ email: RECIPIENT }],
    },
  ],
};

function expectedChannel(enabled: boolean): PulseChannelCompact {
  return {
    channel_type: "email",
    enabled,
    schedule_type: "daily",
    schedule_hour: 8,
    schedule_day: null,
    schedule_frame: null,
    recipients: [{ email: RECIPIENT }],
  };
}

function expectedCompact(id: number): PulseCompact {
  return {
    id,
    name: SUBSCRIPTION_NAME,
    dashboard_id: SEEDED.ordersDashboardId,
    collection_id: SEEDED.defaultCollectionId,
    archived: false,
    skip_if_empty: false,
    cards: [
      {
        id: SEEDED.ordersCardId,
        name: "Orders by status",
        dashboard_card_id: SEEDED.ordersDashcardId,
        include_csv: false,
        include_xls: false,
      },
    ],
    channels: [expectedChannel(true)],
  };
}

describe("subscription e2e", () => {
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

  async function createSubscription(): Promise<number> {
    const result = await runCli({
      args: ["subscription", "create", "--json"],
      stdin: JSON.stringify(NEW_SUBSCRIPTION_BODY),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    return parseJson(result.stdout, PulseCompact).id;
  }

  it("list returns an empty envelope on a fresh restore", async () => {
    const result = await runCli({
      args: ["subscription", "list", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, SubscriptionListEnvelope)).toEqual({
      data: [],
      returned: 0,
      total: 0,
    });
  });

  it("create returns the subscription in compact form, with the dashboard's collection applied", async () => {
    const result = await runCli({
      args: ["subscription", "create", "--json"],
      stdin: JSON.stringify(NEW_SUBSCRIPTION_BODY),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const created = parseJson(result.stdout, PulseCompact);
    expect(created).toEqual(expectedCompact(created.id));
  });

  it("create with an unknown channel_type fails on Zod validation before any request", async () => {
    const result = await runCli({
      args: ["subscription", "create", "--json"],
      stdin: JSON.stringify({
        ...NEW_SUBSCRIPTION_BODY,
        channels: [{ channel_type: "carrier-pigeon", schedule_type: "daily", schedule_hour: 8 }],
      }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("request body: value did not match expected schema");
    expect(result.stdout).toBe("");
  });

  it("create + list shows the new subscription via the compact projection", async () => {
    const id = await createSubscription();

    const result = await runCli({
      args: ["subscription", "list", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, SubscriptionListEnvelope)).toEqual({
      data: [expectedCompact(id)],
      returned: 1,
      total: 1,
    });
  });

  it("list --dashboard-id narrows to subscriptions on that dashboard", async () => {
    const id = await createSubscription();

    const matching = await runCli({
      args: ["subscription", "list", "--dashboard-id", String(SEEDED.ordersDashboardId), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(matching.exitCode, matching.stderr).toBe(0);
    expect(parseJson(matching.stdout, SubscriptionListEnvelope)).toEqual({
      data: [expectedCompact(id)],
      returned: 1,
      total: 1,
    });

    const other = await runCli({
      args: ["subscription", "list", "--dashboard-id", String(OTHER_DASHBOARD_ID), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(other.exitCode, other.stderr).toBe(0);
    expect(parseJson(other.stdout, SubscriptionListEnvelope)).toEqual({
      data: [],
      returned: 0,
      total: 0,
    });
  });

  it("`dashboard subscriptions` lists the subscriptions on that dashboard", async () => {
    const id = await createSubscription();

    const result = await runCli({
      args: ["dashboard", "subscriptions", String(SEEDED.ordersDashboardId), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, SubscriptionListEnvelope)).toEqual({
      data: [expectedCompact(id)],
      returned: 1,
      total: 1,
    });
  });

  it("`dashboard subscriptions` is empty for a dashboard with none", async () => {
    const result = await runCli({
      args: ["dashboard", "subscriptions", String(SEEDED.ordersDashboardId), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, SubscriptionListEnvelope)).toEqual({
      data: [],
      returned: 0,
      total: 0,
    });
  });

  it("`dashboard subscriptions` with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["dashboard", "subscriptions", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("get returns the subscription by id in compact form", async () => {
    const id = await createSubscription();

    const result = await runCli({
      args: ["subscription", "get", String(id), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, PulseCompact)).toEqual(expectedCompact(id));
  });

  it("get with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["subscription", "get", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("get against a missing subscription id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["subscription", "get", "9999999", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Not found: GET /api/pulse/9999999.");
  });

  it("update renames the subscription and replaces its delivery channels", async () => {
    const id = await createSubscription();

    const result = await runCli({
      args: ["subscription", "update", String(id), "--json"],
      stdin: JSON.stringify({
        name: "Daily orders",
        channels: [
          {
            channel_type: "email",
            schedule_type: "weekly",
            schedule_hour: 6,
            schedule_day: "mon",
            recipients: [{ email: RECIPIENT }],
          },
        ],
      }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, PulseCompact)).toEqual({
      ...expectedCompact(id),
      name: "Daily orders",
      channels: [
        {
          channel_type: "email",
          enabled: true,
          schedule_type: "weekly",
          schedule_hour: 6,
          schedule_day: "mon",
          schedule_frame: null,
          recipients: [{ email: RECIPIENT }],
        },
      ],
    });
  });

  // `PUT /api/pulse/:id` defaults every omitted key, and `archived`/`skip_if_empty` both default
  // to false — so a name-only patch would un-archive the subscription and clear skip_if_empty
  // unless the CLI carries the stored values forward.
  it("update leaves an archived subscription archived when the patch does not mention it", async () => {
    const id = await createSubscription();

    const archiveResult = await runCli({
      args: ["subscription", "archive", String(id), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(archiveResult.exitCode, archiveResult.stderr).toBe(0);

    const renameResult = await runCli({
      args: ["subscription", "update", String(id), "--json"],
      stdin: JSON.stringify({ name: "Daily orders" }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(renameResult.exitCode, renameResult.stderr).toBe(0);
    expect(parseJson(renameResult.stdout, PulseCompact)).toEqual({
      ...expectedCompact(id),
      name: "Daily orders",
      archived: true,
      channels: [expectedChannel(false)],
    });
  });

  it("update preserves skip_if_empty when the patch does not mention it", async () => {
    const id = await createSubscription();

    const enable = await runCli({
      args: ["subscription", "update", String(id), "--json"],
      stdin: JSON.stringify({ skip_if_empty: true }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(enable.exitCode, enable.stderr).toBe(0);

    const rename = await runCli({
      args: ["subscription", "update", String(id), "--json"],
      stdin: JSON.stringify({ name: "Daily orders" }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(rename.exitCode, rename.stderr).toBe(0);
    expect(parseJson(rename.stdout, PulseCompact)).toEqual({
      ...expectedCompact(id),
      name: "Daily orders",
      skip_if_empty: true,
    });
  });

  it("archive preserves skip_if_empty", async () => {
    const id = await createSubscription();

    const enable = await runCli({
      args: ["subscription", "update", String(id), "--json"],
      stdin: JSON.stringify({ skip_if_empty: true }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(enable.exitCode, enable.stderr).toBe(0);

    const result = await runCli({
      args: ["subscription", "archive", String(id), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, PulseCompact)).toEqual({
      ...expectedCompact(id),
      archived: true,
      skip_if_empty: true,
      channels: [expectedChannel(false)],
    });
  });

  it("archive flips archived, disables the channels, and moves it under --archived", async () => {
    const id = await createSubscription();

    const archivedCompact: PulseCompact = {
      ...expectedCompact(id),
      archived: true,
      channels: [expectedChannel(false)],
    };

    const archiveResult = await runCli({
      args: ["subscription", "archive", String(id), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(archiveResult.exitCode, archiveResult.stderr).toBe(0);
    expect(parseJson(archiveResult.stdout, PulseCompact)).toEqual(archivedCompact);

    const activeList = await runCli({
      args: ["subscription", "list", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(activeList.exitCode, activeList.stderr).toBe(0);
    expect(parseJson(activeList.stdout, SubscriptionListEnvelope)).toEqual({
      data: [],
      returned: 0,
      total: 0,
    });

    const archivedList = await runCli({
      args: ["subscription", "list", "--archived", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(archivedList.exitCode, archivedList.stderr).toBe(0);
    expect(parseJson(archivedList.stdout, SubscriptionListEnvelope)).toEqual({
      data: [archivedCompact],
      returned: 1,
      total: 1,
    });
  });
});
