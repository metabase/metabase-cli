import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { parseJson } from "@metabase/client/json";

import { SdkVersionResult } from "../../packages/cli/src/commands/data-app/sdk-version";
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { type RegistryFixture, startRegistryFixture } from "./registry-fixture";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { requireRelease, stackRelease } from "./server-gate";

const releaseSkip = requireRelease("data-app sdk-version › release");

describe.skipIf(releaseSkip !== null)("data-app sdk-version e2e", () => {
  let bootstrap: E2EBootstrap;
  let fixture: RegistryFixture;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    bootstrap = await readBootstrap();
    fixture = await startRegistryFixture({ latest: "0.1.0" });
  });

  afterAll(async () => {
    await fixture.close();
  });

  afterEach(async () => {
    fixture.reset();
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function sdkVersion(format: "json" | "text") {
    const configHome = await mkTempConfigHome();
    tempDirs.push(configHome);
    return runCli({
      args: ["data-app", "sdk-version", "--format", format, "--registry", fixture.url],
      configHome,
      env: { MB_URL: bootstrap.baseUrl, MB_API_KEY: bootstrap.adminApiKey },
    });
  }

  it("answers the SDK tag of the server's major, with the server's version", async () => {
    const { tag, major } = stackRelease();
    fixture.setDistTags({ latest: `0.${major}.3`, [`${major}-stable`]: `0.${major}.3` });

    const result = await sdkVersion("json");

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, SdkVersionResult)).toEqual({
      metabaseVersion: tag,
      tag: `${major}-stable`,
      version: `0.${major}.3`,
    });
  });

  it("prints the bare tag as text, so the install composes in a shell", async () => {
    const { major } = stackRelease();
    fixture.setDistTags({ latest: `0.${major}.3`, [`${major}-stable`]: `0.${major}.3` });

    const result = await sdkVersion("text");

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toBe(`${major}-stable`);
  });
});
