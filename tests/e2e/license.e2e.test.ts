import { afterEach, describe, expect, it } from "vitest";

import { LicenseRemoveResult } from "../../src/commands/license/remove";
import { LicenseSetResult } from "../../src/commands/license/set";
import { LicenseStatus } from "../../src/commands/license/status";

import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";

// A syntactically valid dev-shaped token — `mb_dev_` + 57 hex chars per Metabase's
// RemoteCheckedToken regex. Storage commands never validate against Metabase, so
// any opaque string works; this format guards against a future stricter check.
const DUMMY_DEV_TOKEN = "mb_dev_0123456789abcdef0123456789abcdef0123456789abcdef0123456789a";

describe("license storage e2e", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function makeIsolatedConfigHome(): Promise<string> {
    const dir = await mkTempConfigHome();
    tempDirs.push(dir);
    return dir;
  }

  it("set with piped stdin → status reflects present without leaking the token", async () => {
    const configHome = await makeIsolatedConfigHome();

    const set = await runCli({
      args: ["license", "set", "--json"],
      stdin: DUMMY_DEV_TOKEN,
      configHome,
    });

    expect(set.exitCode, set.stderr).toBe(0);
    expect(set.stdout).not.toContain(DUMMY_DEV_TOKEN);
    expect(set.stderr).not.toContain(DUMMY_DEV_TOKEN);
    expect(LicenseSetResult.parse(JSON.parse(set.stdout))).toEqual({ stored: true });

    const status = await runCli({
      args: ["license", "status", "--json"],
      configHome,
    });

    expect(status.exitCode, status.stderr).toBe(0);
    expect(status.stdout).not.toContain(DUMMY_DEV_TOKEN);
    expect(LicenseStatus.parse(JSON.parse(status.stdout))).toEqual({ present: true });
  });

  it("remove --yes clears the token and is idempotent on a second remove", async () => {
    const configHome = await makeIsolatedConfigHome();

    await runCli({
      args: ["license", "set", "--json"],
      stdin: DUMMY_DEV_TOKEN,
      configHome,
    });

    const firstRemove = await runCli({
      args: ["license", "remove", "--yes", "--json"],
      configHome,
    });
    expect(firstRemove.exitCode, firstRemove.stderr).toBe(0);
    expect(LicenseRemoveResult.parse(JSON.parse(firstRemove.stdout))).toEqual({
      removed: true,
      aborted: false,
    });

    const status = await runCli({
      args: ["license", "status", "--json"],
      configHome,
    });
    expect(LicenseStatus.parse(JSON.parse(status.stdout))).toEqual({ present: false });

    const secondRemove = await runCli({
      args: ["license", "remove", "--yes", "--json"],
      configHome,
    });
    expect(secondRemove.exitCode, secondRemove.stderr).toBe(0);
    expect(LicenseRemoveResult.parse(JSON.parse(secondRemove.stdout))).toEqual({
      removed: false,
      aborted: false,
    });
  });
});

// Future EE-feature tests that require a real dev token + matching token-check
// server go inside this gate. Today no CLI command pushes the license to a
// connected Metabase instance, so the gate stays empty — but the pattern is
// here so adding such a command lands tests under the same gate without
// touching docker-compose or CLAUDE.md again.
const realToken = process.env["MB_PREMIUM_EMBEDDING_TOKEN"] ?? "";
const realStoreUrl = process.env["METASTORE_DEV_SERVER_URL"] ?? "";
const licenseGateActive = realToken !== "" && realStoreUrl !== "";

const describeIfLicensed = licenseGateActive ? describe : describe.skip;

describeIfLicensed(
  "license EE integration e2e (set MB_PREMIUM_EMBEDDING_TOKEN + METASTORE_DEV_SERVER_URL to enable)",
  () => {
    // Implementations land here when a CLI command exists that exercises an
    // EE-gated Metabase endpoint. The token is read from process.env at the
    // top of this module and threaded into runCli({ stdin: realToken }) only —
    // never logged, never asserted on, never written to disk.
    it.todo("activates a premium feature on the connected instance");
  },
);
