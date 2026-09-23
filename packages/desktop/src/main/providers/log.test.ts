import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openProviderLog, scrub } from "./log";

const directories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "rde-provider-log-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("scrub", () => {
  it("removes a secret the app handed the provider", () => {
    expect(scrub("MB_AUTH_BROKER_TOKEN=abc123 said hello", ["abc123"])).toBe(
      "MB_AUTH_BROKER_TOKEN=[redacted] said hello",
    );
  });

  it("removes a bearer credential the app never saw", () => {
    expect(scrub("authorization: Bearer 0123456789abcdefghij", [])).toBe(
      "authorization: [redacted]",
    );
  });

  it("leaves ordinary output alone", () => {
    expect(scrub("wrote transform-tests/orders_clean.yaml", ["abc123"])).toBe(
      "wrote transform-tests/orders_clean.yaml",
    );
  });
});

describe("the provider log", () => {
  it("writes the scrubbed stream under the session id", async () => {
    const directory = await temporaryDirectory();
    const log = await openProviderLog({
      directory,
      sessionId: "ses_7c1f",
      secrets: ["abc123"],
    });
    log.write("starting with token abc123\n");
    await log.close();

    expect(await readFile(join(directory, "ses_7c1f.log"), "utf8")).toBe(
      "starting with token [redacted]\n",
    );
  });

  it("stops at the size cap and says so", async () => {
    const directory = await temporaryDirectory();
    const log = await openProviderLog({ directory, sessionId: "ses_big", secrets: [] });
    log.write("a".repeat(4 * 1024 * 1024));
    log.write("dropped after the cap\n");
    log.write("dropped as well\n");
    await log.close();

    const written = await readFile(join(directory, "ses_big.log"), "utf8");
    expect(written).toBe(
      `${"a".repeat(4 * 1024 * 1024)}\n[redacted] the provider log reached its size cap and stops here\n`,
    );
  });
});
