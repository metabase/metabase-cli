import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { NOT_CONNECTED_MESSAGE } from "../auth/session-environment";

import { FIXTURE_CREDENTIALS, openCliFixture, recorded, type CliFixture } from "./cli-fixture";

const Counted = z.object({ tables: z.number().int() }).loose();

const Report = z.object({ ok: z.boolean(), checked: z.number().int(), failed: z.number().int() });

const fixtures: CliFixture[] = [];

async function fixture(): Promise<CliFixture> {
  const opened = await openCliFixture(FIXTURE_CREDENTIALS);
  fixtures.push(opened);
  return opened;
}

afterEach(async () => {
  for (const opened of fixtures.splice(0)) {
    await opened.close();
  }
});

describe("MetabaseCli", () => {
  it("runs the CLI as Node under a broker session of its own and parses its JSON", async () => {
    const cli = await fixture();
    await cli.answer("db list", {
      stdout: JSON.stringify({
        databases: 1,
        tables: 7,
        fields: 40,
      }),
      stderr: "",
      exit: 0,
    });

    const outcome = await cli.cli.run("/", ["db", "list"], Counted);

    expect(outcome).toEqual({
      kind: "answered",
      value: {
        databases: 1,
        tables: 7,
        fields: 40,
      },
    });
    expect(await cli.calls()).toEqual([
      {
        args: ["db", "list", "--json"],
        cwd: "/",
        env: {
          MB_URL: FIXTURE_CREDENTIALS.MB_URL,
          MB_AUTH_BROKER: FIXTURE_CREDENTIALS.MB_AUTH_BROKER,
          MB_AUTH_BROKER_TOKEN: FIXTURE_CREDENTIALS.MB_AUTH_BROKER_TOKEN,
          MB_SKILLS_DIR: cli.location.skills,
          ELECTRON_RUN_AS_NODE: "1",
        },
      },
    ]);
    expect(cli.released).toEqual([FIXTURE_CREDENTIALS.sessionId]);
  });

  it("reports the message of the error envelope the CLI printed after its warnings", async () => {
    const cli = await fixture();
    await cli.answer("git-sync status", {
      stdout: "",
      stderr: await recorded("git-sync-status.unlicensed.stderr"),
      exit: 2,
    });

    expect(await cli.cli.run("/", ["git-sync", "status"], Counted)).toEqual({
      kind: "failed",
      message:
        "This operation requires the 'remote_sync' premium feature (not enabled on this server).",
    });
    expect(cli.released).toEqual([FIXTURE_CREDENTIALS.sessionId]);
  });

  it("names the instance that did not answer instead of the transport's words", async () => {
    const cli = await fixture();
    await cli.answer("git-sync status", {
      stdout: "",
      stderr: await recorded("git-sync-status.unreachable.stderr"),
      exit: 1,
    });

    expect(await cli.cli.run("/", ["git-sync", "status"], Counted)).toEqual({
      kind: "failed",
      message: `Metabase at ${FIXTURE_CREDENTIALS.MB_URL} didn't answer. Check that it's running and reachable, then try again.`,
    });
  });

  it("names the command whose output does not match what the app reads", async () => {
    const cli = await fixture();
    await cli.answer("db list", { stdout: '{"tables":"seven"}', stderr: "", exit: 0 });

    expect(await cli.cli.run("/", ["db", "list"], Counted)).toEqual({
      kind: "failed",
      message: expect.stringContaining("mb db list: "),
    });
  });

  it("refuses without running anything when no Metabase is connected", async () => {
    const cli = await openCliFixture(null);
    fixtures.push(cli);

    expect(await cli.cli.run("/", ["git-sync", "status"], Counted)).toEqual({
      kind: "failed",
      message: NOT_CONNECTED_MESSAGE,
    });
    expect(await cli.calls()).toEqual([]);
  });

  it("reads a report's answer on the failure exit it ends with", async () => {
    const cli = await fixture();
    await cli.answer("validate collections/transforms/orders_by_status.yaml", {
      stdout: await recorded("validate.segment-without-definition.stdout"),
      stderr: await recorded("validate.segment-without-definition.stderr"),
      exit: 1,
    });

    const outcome = await cli.cli.report(
      "/",
      ["validate", "collections/transforms/orders_by_status.yaml"],
      Report,
    );

    expect(outcome).toEqual({ kind: "answered", value: { ok: false, checked: 3, failed: 1 } });
  });

  it("reads a failure exit that printed no answer as the CLI's refusal", async () => {
    const cli = await fixture();
    await cli.answer("transform-test list", {
      stdout: "",
      stderr: await recorded("transform-test-list.unlicensed.stderr"),
      exit: 1,
    });

    expect(await cli.cli.report("/", ["transform-test", "list"], Report)).toEqual({
      kind: "failed",
      message:
        "This operation requires the 'transforms-testing' premium feature (not enabled on this server).",
    });
  });

  it("keeps a failure exit a failure for a command that is not a report", async () => {
    const cli = await fixture();
    await cli.answer("validate collections/transforms/orders_by_status.yaml", {
      stdout: await recorded("validate.segment-without-definition.stdout"),
      stderr: await recorded("validate.segment-without-definition.stderr"),
      exit: 1,
    });

    const outcome = await cli.cli.run(
      "/",
      ["validate", "collections/transforms/orders_by_status.yaml"],
      Report,
    );

    expect(outcome).toEqual({
      kind: "failed",
      message:
        "1 of 3 file(s) failed validation; validation is structural: a file that passes can still name a table, card or collection the instance does not have, or a query it cannot run",
    });
  });
});
