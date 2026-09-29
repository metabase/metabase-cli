import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  ModerationReview,
  ModerationReviewCompact,
} from "@metabase/client/domain/moderation-review";
import { parseJson } from "@metabase/client/json";

import { CommandHelpEntry } from "../../packages/cli/src/runtime/command-help";
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorCategory, cliErrorMessage } from "./cli-error";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { seedProbedProfile } from "./seed-profile";
import { SEEDED } from "./seed/seeded";
import { requireServer } from "./server-gate";

const CONTENT_VERIFICATION_REFUSAL =
  "This operation requires the 'content_verification' premium feature (not enabled on this server).";

const skipReason = requireServer(
  "verify › card and dashboard verify against licensed content verification",
  ["contentVerification"],
);

describe("verify arg validation e2e (no Metabase contact required)", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function makeIsolatedConfigHome(): Promise<string> {
    const dir = await mkTempConfigHome();
    tempDirs.push(dir);
    return dir;
  }

  it("card verify rejects a non-integer id with ConfigError", async () => {
    const result = await runCli({
      args: ["card", "verify", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("dashboard verify rejects a zero id with ConfigError", async () => {
    const result = await runCli({
      args: ["dashboard", "verify", "0", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe("invalid id: 0 (must be ≥ 1)");
    expect(result.stdout).toBe("");
  });

  it("refuses before any request when the cached probe lacks content verification", async () => {
    const configHome = await makeIsolatedConfigHome();
    await seedProbedProfile(configHome, 64);

    const result = await runCli({ args: ["card", "verify", "1", "--json"], configHome });

    expect(result.exitCode).toBe(2);
    expect(cliErrorCategory(result.stderr)).toBe("capability");
    expect(cliErrorMessage(result.stderr)).toBe(CONTENT_VERIFICATION_REFUSAL);
    expect(result.stdout).toBe("");
  });

  it.each([["card"], ["dashboard"]])(
    "help --json reports the content verification feature behind %s verify",
    async (noun) => {
      const result = await runCli({
        args: [noun, "verify", "--help", "--json"],
        configHome: await makeIsolatedConfigHome(),
      });

      expect(result.exitCode, result.stderr).toBe(0);
      const entry = parseJson(result.stdout, CommandHelpEntry, { source: "--help --json" });
      expect(entry.requires).toEqual({
        methods: ["moderationReview.create"],
        features: ["contentVerification"],
      });
    },
  );
});

describe.skipIf(skipReason === null)(
  "verify capability gate against a server without content verification",
  () => {
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

    it("card verify refuses with CapabilityError (exit 2) after a live probe", async () => {
      const result = await runCli({
        args: ["card", "verify", String(SEEDED.ordersCardId), "--json"],
        configHome: await makeIsolatedConfigHome(),
        env: { MB_URL: bootstrap.baseUrl, MB_API_KEY: bootstrap.adminApiKey },
      });

      expect(result.exitCode).toBe(2);
      expect(cliErrorCategory(result.stderr)).toBe("capability");
      expect(cliErrorMessage(result.stderr)).toBe(CONTENT_VERIFICATION_REFUSAL);
      expect(result.stdout).toBe("");
    });
  },
);

describe.skipIf(skipReason !== null)(
  "verify › card and dashboard verify against licensed content verification",
  () => {
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

    async function runVerify(noun: string, ...args: string[]) {
      return runCli({
        args: [noun, "verify", ...args],
        configHome: await makeIsolatedConfigHome(),
        env: { MB_URL: bootstrap.baseUrl, MB_API_KEY: bootstrap.adminApiKey },
      });
    }

    it("card verify records a verified review on the card", async () => {
      const result = await runVerify("card", String(SEEDED.ordersCardId), "--json");

      expect(result.exitCode, result.stderr).toBe(0);
      expect(parseJson(result.stdout, ModerationReviewCompact)).toEqual({
        id: expect.any(Number),
        moderated_item_id: SEEDED.ordersCardId,
        moderated_item_type: "card",
        status: "verified",
        text: null,
        most_recent: true,
      });
    });

    it("dashboard verify --text stores the note with the review", async () => {
      const result = await runVerify(
        "dashboard",
        String(SEEDED.ordersDashboardId),
        "--text",
        "Reviewed the filters",
        "--json",
      );

      expect(result.exitCode, result.stderr).toBe(0);
      expect(parseJson(result.stdout, ModerationReviewCompact)).toEqual({
        id: expect.any(Number),
        moderated_item_id: SEEDED.ordersDashboardId,
        moderated_item_type: "dashboard",
        status: "verified",
        text: "Reviewed the filters",
        most_recent: true,
      });
    });

    it("--remove records a review with no status that supersedes the verification", async () => {
      const verified = await runVerify("card", String(SEEDED.ordersCardId), "--json");
      expect(verified.exitCode, verified.stderr).toBe(0);
      const verifiedId = parseJson(verified.stdout, ModerationReviewCompact).id;

      const result = await runVerify("card", String(SEEDED.ordersCardId), "--remove", "--json");

      expect(result.exitCode, result.stderr).toBe(0);
      const review = parseJson(result.stdout, ModerationReviewCompact);
      expect(review).toEqual({
        id: expect.any(Number),
        moderated_item_id: SEEDED.ordersCardId,
        moderated_item_type: "card",
        status: null,
        text: null,
        most_recent: true,
      });
      expect(review.id).toBeGreaterThan(verifiedId);
    });

    it("--full carries the moderator and the timestamps", async () => {
      const result = await runVerify("card", String(SEEDED.ordersCardId), "--full", "--json");

      expect(result.exitCode, result.stderr).toBe(0);
      expect(parseJson(result.stdout, ModerationReview)).toEqual({
        id: expect.any(Number),
        moderated_item_id: SEEDED.ordersCardId,
        moderated_item_type: "card",
        moderator_id: expect.any(Number),
        status: "verified",
        text: null,
        most_recent: true,
        created_at: expect.any(String),
        updated_at: expect.any(String),
      });
    });

    it("text output names the verified item", async () => {
      const result = await runVerify(
        "dashboard",
        String(SEEDED.ordersDashboardId),
        "--format",
        "text",
      );

      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toBe(`Verified dashboard ${SEEDED.ordersDashboardId}.`);
    });

    it("verify of a missing card is Not found (exit 1)", async () => {
      const result = await runVerify("card", "9999999", "--json");

      expect(result.exitCode).toBe(1);
      expect(cliErrorMessage(result.stderr)).toBe("Not found: POST /api/moderation-review.");
      expect(result.stdout).toBe("");
    });
  },
);
