import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { FeatureName } from "@metabase/client/version/features";
import { parseJson } from "@metabase/client/json";

import { TestListEnvelope } from "../../packages/cli/src/commands/test/list";
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorCategory, cliErrorMessage } from "./cli-error";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { requirementFailure, requireServerWithout, DOWNGRADE_REMEDY } from "./server-gate";

let bootstrap: E2EBootstrap;
const tempDirs: string[] = [];

beforeAll(async () => {
  bootstrap = await readBootstrap();
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
});

async function mb(args: string[]) {
  const configHome = await mkTempConfigHome();
  tempDirs.push(configHome);
  return runCli({
    args,
    configHome,
    env: { MB_URL: bootstrap.baseUrl, MB_API_KEY: bootstrap.adminApiKey },
  });
}

// The refusal a server without `feature` answers with, as the client explains it.
function liveRefusal(feature: FeatureName): string {
  const gap = requirementFailure([feature]);
  if (gap === null) {
    throw new Error(`this lane runs only on a server without ${feature}`);
  }
  return gap.reason === "version-too-old" ? `${gap.detail}\n${DOWNGRADE_REMEDY}` : gap.detail;
}

describe("test e2e, refs", () => {
  it("refuses a test ref where the entity under test belongs, before reaching the server", async () => {
    const result = await mb(["test", "create", "--id", "card-test:12", "--body", "{}"]);

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(
      'invalid --id: "card-test:12" names a test; this command takes the entity under test, <type>:<id>, such as card:12',
    );
  });

  it("refuses a type no test covers", async () => {
    const result = await mb(["test", "get", "--id", "dashboard-test:7"]);

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(
      'invalid --id: "dashboard-test:7" (expected <type>-test:<id>, such as card-test:34, where <type> is one of: transform, card, segment, measure, action)',
    );
  });

  it("refuses an --id and --type that name different types", async () => {
    const result = await mb(["test", "list", "--id", "card:12", "--type", "segment"]);

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(
      "--id card:12 is not of type segment; drop --type or --id",
    );
  });
});

const noCardTestsSkipReason = requireServerWithout("test › server without card tests", [
  "cardTests",
]);

describe.skipIf(noCardTestsSkipReason !== null)("test e2e on a server without card tests", () => {
  it("explains a card test the server cannot hold with its own answer and exits 2", async () => {
    const result = await mb(["test", "get", "--id", "card-test:1", "--json"]);

    expect(result.exitCode).toBe(2);
    expect(cliErrorCategory(result.stderr)).toBe("capability");
    expect(cliErrorMessage(result.stderr)).toBe(liveRefusal("cardTests"));
  });

  it("explains a card test run the same way", async () => {
    const result = await mb(["test", "run", "--id", "card-test:1", "--json"]);

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(liveRefusal("cardTests"));
  });

  it("explains a listing narrowed to card tests the same way", async () => {
    const result = await mb(["test", "list", "--type", "card", "--json"]);

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(liveRefusal("cardTests"));
  });
});

const noTestTypesSkipReason = requireServerWithout("test › server without any new test type", [
  "cardTests",
  "segmentTests",
  "measureTests",
  "actionTests",
]);

describe.skipIf(noTestTypesSkipReason !== null)(
  "test e2e on a server with only transform tests, or none",
  () => {
    it("lists every test the instance holds, which on a fresh instance is none", async () => {
      const result = await mb(["test", "list", "--json"]);

      expect(result.exitCode, result.stderr).toBe(0);
      expect(parseJson(result.stdout, TestListEnvelope)).toEqual({
        data: [],
        returned: 0,
        offset: 0,
        total: 0,
        has_more: false,
        next_offset: null,
      });
    });
  },
);

const noTestSuitesSkipReason = requireServerWithout("test-suite › server without test suites", [
  "testSuites",
]);

describe.skipIf(noTestSuitesSkipReason !== null)(
  "test-suite e2e on a server without test suites",
  () => {
    it("explains the listing with the server's own answer and exits 2", async () => {
      const result = await mb(["test-suite", "list", "--json"]);

      expect(result.exitCode).toBe(2);
      expect(cliErrorCategory(result.stderr)).toBe("capability");
      expect(cliErrorMessage(result.stderr)).toBe(liveRefusal("testSuites"));
    });

    it("explains a suite run the same way", async () => {
      const result = await mb(["test-suite", "run", "--id", "1"]);

      expect(result.exitCode).toBe(2);
      expect(cliErrorMessage(result.stderr)).toBe(liveRefusal("testSuites"));
    });
  },
);
