import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { AlertListEnvelope } from "../../src/commands/alert/list";
import { AlertSendResult } from "../../src/commands/alert/send";
import { NotificationCompact, type NotificationCreateInput } from "../../src/domain/notification";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorMessage } from "./cli-error";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { SEEDED } from "./seed/seeded";

const RECIPIENT = "team@example.com";
const DAILY_AT_EIGHT = "0 0 8 * * ? *";
const DAILY_AT_NINE = "0 0 9 * * ? *";
const OTHER_CARD_ID = SEEDED.ordersCardId + 1000;

const NEW_ALERT_BODY: NotificationCreateInput = {
  payload_type: "notification/card",
  payload: { card_id: SEEDED.ordersCardId, send_condition: "has_result", send_once: false },
  subscriptions: [{ type: "notification-subscription/cron", cron_schedule: DAILY_AT_EIGHT }],
  handlers: [
    {
      channel_type: "channel/email",
      recipients: [{ type: "notification-recipient/raw-value", details: { value: RECIPIENT } }],
    },
  ],
};

function expectedCompact(id: number, creatorId: number | null): NotificationCompact {
  return {
    id,
    payload_type: "notification/card",
    active: true,
    creator_id: creatorId,
    payload: {
      card_id: SEEDED.ordersCardId,
      send_condition: "has_result",
      send_once: false,
    },
    subscriptions: [{ type: "notification-subscription/cron", cron_schedule: DAILY_AT_EIGHT }],
    handlers: [
      {
        channel_type: "channel/email",
        channel_id: null,
        recipients: [
          {
            type: "notification-recipient/raw-value",
            user_id: null,
            permissions_group_id: null,
            details: { value: RECIPIENT },
          },
        ],
      },
    ],
  };
}

describe("alert e2e", () => {
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

  async function createAlert(): Promise<NotificationCompact> {
    const result = await runCli({
      args: ["alert", "create", "--json"],
      stdin: JSON.stringify(NEW_ALERT_BODY),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    return parseJson(result.stdout, NotificationCompact);
  }

  it("list returns an empty envelope on a fresh restore, hiding the seeded system-event notifications", async () => {
    const result = await runCli({
      args: ["alert", "list", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, AlertListEnvelope)).toEqual({
      data: [],
      returned: 0,
      total: 0,
    });
  });

  it("create returns the alert in compact form, without the hydrated card", async () => {
    const result = await runCli({
      args: ["alert", "create", "--json"],
      stdin: JSON.stringify(NEW_ALERT_BODY),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const created = parseJson(result.stdout, NotificationCompact);
    expect(created).toEqual(expectedCompact(created.id, created.creator_id));
  });

  it("create with an unknown send_condition fails on Zod validation before any request", async () => {
    const result = await runCli({
      args: ["alert", "create", "--json"],
      stdin: JSON.stringify({
        ...NEW_ALERT_BODY,
        payload: { card_id: SEEDED.ordersCardId, send_condition: "when_i_feel_like_it" },
      }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("request body: value did not match expected schema");
    expect(result.stdout).toBe("");
  });

  it("create + list shows the new alert via the compact projection", async () => {
    const created = await createAlert();

    const result = await runCli({
      args: ["alert", "list", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, AlertListEnvelope)).toEqual({
      data: [expectedCompact(created.id, created.creator_id)],
      returned: 1,
      total: 1,
    });
  });

  it("list --card-id narrows to alerts watching that card", async () => {
    const created = await createAlert();

    const matching = await runCli({
      args: ["alert", "list", "--card-id", String(SEEDED.ordersCardId), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(matching.exitCode, matching.stderr).toBe(0);
    expect(parseJson(matching.stdout, AlertListEnvelope)).toEqual({
      data: [expectedCompact(created.id, created.creator_id)],
      returned: 1,
      total: 1,
    });

    const other = await runCli({
      args: ["alert", "list", "--card-id", String(OTHER_CARD_ID), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(other.exitCode, other.stderr).toBe(0);
    expect(parseJson(other.stdout, AlertListEnvelope)).toEqual({
      data: [],
      returned: 0,
      total: 0,
    });
  });

  it("`card alerts` lists the alerts watching that card", async () => {
    const created = await createAlert();

    const result = await runCli({
      args: ["card", "alerts", String(SEEDED.ordersCardId), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, AlertListEnvelope)).toEqual({
      data: [expectedCompact(created.id, created.creator_id)],
      returned: 1,
      total: 1,
    });
  });

  it("`card alerts` is empty for a card with none", async () => {
    const result = await runCli({
      args: ["card", "alerts", String(SEEDED.ordersCardId), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, AlertListEnvelope)).toEqual({
      data: [],
      returned: 0,
      total: 0,
    });
  });

  it("`card alerts` with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["card", "alerts", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("get returns the alert by id in compact form", async () => {
    const created = await createAlert();

    const result = await runCli({
      args: ["alert", "get", String(created.id), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, NotificationCompact)).toEqual(
      expectedCompact(created.id, created.creator_id),
    );
  });

  it("get with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["alert", "get", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("get against a missing alert id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["alert", "get", "9999999", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Not found: GET /api/notification/9999999.");
  });

  // A PUT whose body omits the stored id makes Metabase delete the notification and insert a
  // replacement under a fresh id. `alert update` merges over the fetched object to prevent that,
  // so the alert must still be readable at the same id afterwards.
  it("update merges a partial payload over the stored one and keeps the alert at the same id", async () => {
    const created = await createAlert();

    const updateResult = await runCli({
      args: ["alert", "update", String(created.id), "--json"],
      stdin: JSON.stringify({ payload: { send_condition: "goal_above" } }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(updateResult.exitCode, updateResult.stderr).toBe(0);

    const expected: NotificationCompact = {
      ...expectedCompact(created.id, created.creator_id),
      payload: {
        card_id: SEEDED.ordersCardId,
        send_condition: "goal_above",
        send_once: false,
      },
    };
    expect(parseJson(updateResult.stdout, NotificationCompact)).toEqual(expected);

    const getResult = await runCli({
      args: ["alert", "get", String(created.id), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(getResult.exitCode, getResult.stderr).toBe(0);
    expect(parseJson(getResult.stdout, NotificationCompact)).toEqual(expected);
  });

  it("update replaces the schedule wholesale", async () => {
    const created = await createAlert();

    const result = await runCli({
      args: ["alert", "update", String(created.id), "--json"],
      stdin: JSON.stringify({
        subscriptions: [{ type: "notification-subscription/cron", cron_schedule: DAILY_AT_NINE }],
      }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, NotificationCompact)).toEqual({
      ...expectedCompact(created.id, created.creator_id),
      subscriptions: [{ type: "notification-subscription/cron", cron_schedule: DAILY_AT_NINE }],
    });
  });

  it("archive deactivates the alert; --include-inactive still lists it and update reactivates it", async () => {
    const created = await createAlert();
    const inactive: NotificationCompact = {
      ...expectedCompact(created.id, created.creator_id),
      active: false,
    };

    const archiveResult = await runCli({
      args: ["alert", "archive", String(created.id), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(archiveResult.exitCode, archiveResult.stderr).toBe(0);
    expect(parseJson(archiveResult.stdout, NotificationCompact)).toEqual(inactive);

    const activeList = await runCli({
      args: ["alert", "list", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(activeList.exitCode, activeList.stderr).toBe(0);
    expect(parseJson(activeList.stdout, AlertListEnvelope)).toEqual({
      data: [],
      returned: 0,
      total: 0,
    });

    const inactiveList = await runCli({
      args: ["alert", "list", "--include-inactive", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(inactiveList.exitCode, inactiveList.stderr).toBe(0);
    expect(parseJson(inactiveList.stdout, AlertListEnvelope)).toEqual({
      data: [inactive],
      returned: 1,
      total: 1,
    });

    const reactivate = await runCli({
      args: ["alert", "update", String(created.id), "--json"],
      stdin: JSON.stringify({ active: true }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(reactivate.exitCode, reactivate.stderr).toBe(0);
    expect(parseJson(reactivate.stdout, NotificationCompact)).toEqual(
      expectedCompact(created.id, created.creator_id),
    );
  });

  it("send delivers the alert off-schedule", async () => {
    const created = await createAlert();

    const result = await runCli({
      args: ["alert", "send", String(created.id), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, AlertSendResult)).toEqual({ id: created.id, sent: true });
  });

  it("send against a missing alert id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["alert", "send", "9999999", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Not found: GET /api/notification/9999999.");
  });
});
