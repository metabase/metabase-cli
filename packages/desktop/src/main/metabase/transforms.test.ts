import { afterEach, describe, expect, it } from "vitest";

import { FIXTURE_CREDENTIALS, openCliFixture, recorded, type CliFixture } from "../cli/cli-fixture";

import { lastRunOf, runTransform, runTransformTests } from "./transforms";

const CWD = "/";
const TRANSFORM_ID = 1;

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

describe("runTransform", () => {
  it("waits for the run and answers how it ended", async () => {
    const cli = await fixture();
    await cli.answer("transform run", {
      stdout: await recorded("transform-run.succeeded.stdout"),
      stderr: "",
      exit: 0,
    });

    expect(await runTransform(cli.cli, CWD, TRANSFORM_ID)).toEqual({
      kind: "ran",
      run: { status: "succeeded", at: "2026-09-23T13:44:00.041151Z", message: null },
    });
    expect((await cli.calls()).map((call) => call.args)).toEqual([
      ["transform", "run", "1", "--wait", "--json"],
    ]);
  });
});

describe("lastRunOf", () => {
  it("reads the transform's last run from its full record", async () => {
    const cli = await fixture();
    await cli.answer("transform get", {
      stdout: await recorded("transform-get.last-run.stdout"),
      stderr: "",
      exit: 0,
    });

    expect(await lastRunOf(cli.cli, CWD, TRANSFORM_ID)).toEqual({
      status: "succeeded",
      at: "2026-09-23T13:44:00.041151Z",
      message: null,
    });
  });
});

describe("runTransformTests", () => {
  it("answers the instance's refusal when it has no transform tests", async () => {
    const cli = await fixture();
    await cli.answer("transform-test list", {
      stdout: "",
      stderr: await recorded("transform-test-list.unlicensed.stderr"),
      exit: 2,
    });

    expect(await runTransformTests(cli.cli, CWD, TRANSFORM_ID)).toEqual({
      kind: "refused",
      message:
        "This operation requires the 'transforms-testing' premium feature (not enabled on this server).",
    });
  });

  // Constructed, not recorded: the slot holds no transforms-testing licence. The shapes are the CLI's
  // `transform-test list` envelope and `transform-test run` answer.
  it("runs each test of the transform and names the expectations that did not pass", async () => {
    const cli = await fixture();
    await cli.answer("transform-test list", {
      stdout: JSON.stringify({
        returned: 1,
        offset: 0,
        limit: 50,
        total: 1,
        has_more: false,
        next_offset: null,
        data: [{ id: 4, transform_id: 1, name: "No test rows", description: null }],
      }),
      stderr: "",
      exit: 0,
    });
    await cli.answer("transform-test run", {
      stdout: JSON.stringify({
        status: "failed",
        expectations: [
          { name: "counts every status", type: "empty", status: "passed" },
          {
            name: "drops test rows",
            type: "empty",
            status: "failed",
            columns: [],
            sample: [],
            truncated: 0,
          },
        ],
        tables: {},
      }),
      stderr: "",
      exit: 0,
    });

    expect(await runTransformTests(cli.cli, CWD, TRANSFORM_ID)).toEqual({
      kind: "ran",
      tests: [{ name: "No test rows", status: "failed", failing: ["drops test rows"] }],
    });
    expect((await cli.calls()).map((call) => call.args)).toEqual([
      ["transform-test", "list", "--transform-id", "1", "--json"],
      ["transform-test", "run", "4", "--json"],
    ]);
  });
});
