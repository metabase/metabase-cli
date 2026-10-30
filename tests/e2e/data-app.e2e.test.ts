import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { parseJson } from "@metabase/client/json";

import { SdkVersionResult } from "../../packages/cli/src/commands/data-app/sdk-version";
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorCategory, cliErrorMessage } from "./cli-error";
import { type RegistryFixture, startRegistryFixture } from "./registry-fixture";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { requireVersionKind, stackRelease } from "./server-gate";

const RELEASE_LANE = "data-app sdk-version › release";
const DEVELOPMENT_LANE = "data-app sdk-version › development build";

const releaseSkip = requireVersionKind(RELEASE_LANE, "release");
const developmentSkip = requireVersionKind(DEVELOPMENT_LANE, "development");

describe("data-app sdk-version e2e", () => {
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

  describe.skipIf(releaseSkip !== null)("on a release", () => {
    it("answers the stable tag of the server's major over its pre-releases and the next major", async () => {
      const { tag, major } = stackRelease();
      const nextMajor = major + 1;
      fixture.setDistTags({
        latest: `0.${nextMajor}.0`,
        [`${major}-beta`]: `0.${major}.0-beta.1`,
        [`${major}-stable`]: `0.${major}.3`,
        [`${nextMajor}-alpha`]: `0.${nextMajor}.0-alpha.0`,
      });

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

    it("refuses with exit code 2 when npm publishes no tag for the server's major", async () => {
      const { tag, major } = stackRelease();
      const nextMajor = major + 1;
      fixture.setDistTags({
        latest: `0.${nextMajor}.0`,
        [`${nextMajor}-stable`]: `0.${nextMajor}.0`,
      });

      const result = await sdkVersion("json");

      expect(result.exitCode).toBe(2);
      expect(cliErrorCategory(result.stderr)).toBe("config");
      expect(cliErrorMessage(result.stderr)).toBe(
        `npm publishes no @metabase/embedding-sdk-react tag for Metabase ${tag} (looked for ${major}-stable, ${major}-beta, ${major}-alpha)`,
      );
      expect(result.stdout).toBe("");
    });

    it("surfaces a registry failure as exit code 1 with the registry's answer", async () => {
      fixture.setStatus(500, JSON.stringify({ error: "registry exploded" }));

      const result = await sdkVersion("json");

      expect(result.exitCode).toBe(1);
      expect(cliErrorCategory(result.stderr)).toBe("http");
      expect(cliErrorMessage(result.stderr)).toBe(
        `npm registry answered HTTP 500 for GET ${fixture.url}/-/package/@metabase%2Fembedding-sdk-react/dist-tags: registry exploded`,
      );
      expect(result.stdout).toBe("");
    });
  });

  describe.skipIf(developmentSkip !== null)("on a development build", () => {
    it("refuses with exit code 2 before asking npm, since no published SDK matches it", async () => {
      fixture.setStatus(500, JSON.stringify({ error: "registry exploded" }));

      const result = await sdkVersion("json");

      expect(result.exitCode).toBe(2);
      expect(cliErrorCategory(result.stderr)).toBe("config");
      expect(cliErrorMessage(result.stderr)).toBe(
        `Metabase development build ${bootstrap.server.version.tag} matches no published @metabase/embedding-sdk-react release — install an SDK built from the same Metabase source`,
      );
      expect(result.stdout).toBe("");
    });
  });
});
