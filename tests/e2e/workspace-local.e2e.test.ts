import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LocalWorkspaceListEnvelope } from "../../src/commands/workspace/ps";
import { RemoveResult } from "../../src/commands/workspace/remove";
import { StartResult } from "../../src/commands/workspace/start";
import { StopResult } from "../../src/commands/workspace/stop";
import { UrlResult } from "../../src/commands/workspace/url";
import { Workspace } from "../../src/domain/workspace";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { E2E_DATABASES } from "./seed/ids";

const ENABLE_FLAG = "METABASE_CLI_E2E_DOCKER";
const dockerEnabled = process.env[ENABLE_FLAG] === "1";
const licenseToken = process.env["MB_PREMIUM_EMBEDDING_TOKEN"];
// The same image the e2e docker-compose uses; it's already pulled when the
// developer ran `bun run e2e:up`, so --no-pull is the right default for tests.
const TEST_IMAGE =
  process.env["METABASE_CLI_E2E_LOCAL_IMAGE"] ?? "metabase/metabase-dev:feature-workspaces-v2";
const TEST_HOST_PORT = "13100";
const HEALTH_TIMEOUT_MS = 240_000;
const PROVISION_TIMEOUT_MS = 60_000;
const WORKSPACE_NAME = "e2e_local_workspace";
const FIRST_WORKSPACE_ID = 1;
const ANALYTICS_SCHEMA = "analytics";

function resolveSkipReason(): string | null {
  if (!dockerEnabled) {
    return `set ${ENABLE_FLAG}=1 to opt into local-runtime e2e tests`;
  }
  if (!licenseToken) {
    return "MB_PREMIUM_EMBEDDING_TOKEN is required for local-runtime e2e tests";
  }
  return null;
}

const skipReason = resolveSkipReason();

describe.skipIf(skipReason !== null)("workspace local-runtime e2e", () => {
  let bootstrap: E2EBootstrap;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    bootstrap = await readBootstrap();
  });

  afterAll(async () => {
    // The setup restore-each hook wipes parent state between tests, but it
    // doesn't touch local docker. Tear down the container/volume that the
    // test left behind so reruns start clean.
    await runCli({
      args: ["workspace", "remove", String(FIRST_WORKSPACE_ID), "--yes", "--json"],
      configHome: await pushConfigHome(),
      env: authEnv(),
      timeoutMs: 60_000,
    });
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function pushConfigHome(): Promise<string> {
    const dir = await mkTempConfigHome();
    tempDirs.push(dir);
    return dir;
  }

  function authEnv(): Record<string, string> {
    return {
      METABASE_URL: bootstrap.baseUrl,
      METABASE_API_KEY: bootstrap.adminApiKey,
    };
  }

  async function provisionWorkspaceWithDatabase(): Promise<void> {
    const create = await runCli({
      args: ["workspace", "create", "--name", WORKSPACE_NAME, "--full", "--json"],
      configHome: await pushConfigHome(),
      env: authEnv(),
    });
    expect(create.exitCode, create.stderr).toBe(0);

    const provision = await runCli({
      args: [
        "workspace",
        "database",
        "provision",
        String(FIRST_WORKSPACE_ID),
        "--database-id",
        String(E2E_DATABASES.WAREHOUSE),
        "--schemas",
        ANALYTICS_SCHEMA,
        "--wait",
        "--full",
        "--json",
      ],
      configHome: await pushConfigHome(),
      env: authEnv(),
      timeoutMs: PROVISION_TIMEOUT_MS,
    });
    expect(provision.exitCode, provision.stderr).toBe(0);
    const workspace = parseJson(provision.stdout, Workspace);
    const provisioned = workspace.databases?.find(
      (entry) => entry.database_id === E2E_DATABASES.WAREHOUSE,
    );
    expect(provisioned).toMatchObject({
      database_id: E2E_DATABASES.WAREHOUSE,
      input_schemas: [ANALYTICS_SCHEMA],
      status: "provisioned",
    });
  }

  it(
    "start spins up a healthy local container; ps + url + stop + remove cycle through it",
    async () => {
      if (!licenseToken) {
        throw new Error("test reached body without a license token — skip guard is broken");
      }

      // The setupFile's restore-each hook wipes parent state before this test
      // runs, so the workspace must be created here (not in beforeAll).
      await provisionWorkspaceWithDatabase();

      // 1. Stash the EE token so workspace start can resolve it from the keyring/file fallback.
      const licenseHome = await pushConfigHome();
      const setLicense = await runCli({
        args: ["license", "set", "--json"],
        configHome: licenseHome,
        env: authEnv(),
        stdin: licenseToken,
      });
      expect(setLicense.exitCode, setLicense.stderr).toBe(0);

      // 2. Start the local container. --no-pull because the image is already
      //    on the developer's machine (the e2e parent uses the same image).
      const start = await runCli({
        args: [
          "workspace",
          "start",
          String(FIRST_WORKSPACE_ID),
          "--port",
          TEST_HOST_PORT,
          "--image",
          TEST_IMAGE,
          "--no-pull",
          "--no-metadata",
          "--wait",
          "--full",
          "--json",
        ],
        configHome: licenseHome,
        env: authEnv(),
        timeoutMs: HEALTH_TIMEOUT_MS,
      });
      expect(start.exitCode, start.stderr).toBe(0);
      const startResult = parseJson(start.stdout, StartResult);
      expect(startResult).toEqual({
        workspace_id: FIRST_WORKSPACE_ID,
        workspace_name: WORKSPACE_NAME,
        container_name: `metabase-workspace-${FIRST_WORKSPACE_ID}`,
        state: "running",
        host_port: Number.parseInt(TEST_HOST_PORT, 10),
        url: `http://localhost:${TEST_HOST_PORT}`,
        image: TEST_IMAGE,
      });

      // 3. ps should show the workspace as running.
      const ps = await runCli({
        args: ["workspace", "ps", "--json"],
        configHome: await pushConfigHome(),
        env: authEnv(),
      });
      expect(ps.exitCode, ps.stderr).toBe(0);
      const list = parseJson(ps.stdout, LocalWorkspaceListEnvelope);
      const ours = list.data.find((entry) => entry.workspace_id === FIRST_WORKSPACE_ID);
      expect(ours).toEqual({
        workspace_id: FIRST_WORKSPACE_ID,
        workspace_name: WORKSPACE_NAME,
        state: "running",
        url: `http://localhost:${TEST_HOST_PORT}`,
      });

      // 4. url returns just the local URL.
      const urlOut = await runCli({
        args: ["workspace", "url", String(FIRST_WORKSPACE_ID), "--full", "--json"],
        configHome: await pushConfigHome(),
        env: authEnv(),
      });
      expect(urlOut.exitCode, urlOut.stderr).toBe(0);
      expect(parseJson(urlOut.stdout, UrlResult)).toEqual({
        workspace_id: FIRST_WORKSPACE_ID,
        url: `http://localhost:${TEST_HOST_PORT}`,
      });

      // 5. The boot config dir on the host must be gone — secrets should not linger.
      expect(await listMetabaseTempDirs()).toEqual([]);

      // 6. Stop, then verify ps reflects the new state.
      const stop = await runCli({
        args: ["workspace", "stop", String(FIRST_WORKSPACE_ID), "--full", "--json"],
        configHome: await pushConfigHome(),
        env: authEnv(),
        timeoutMs: 60_000,
      });
      expect(stop.exitCode, stop.stderr).toBe(0);
      const stopResult = parseJson(stop.stdout, StopResult);
      expect(stopResult).toEqual({
        workspace_id: FIRST_WORKSPACE_ID,
        container_name: `metabase-workspace-${FIRST_WORKSPACE_ID}`,
        stopped: true,
        prior_state: "running",
      });

      const psAfterStop = await runCli({
        args: ["workspace", "ps", "--full", "--json"],
        configHome: await pushConfigHome(),
        env: authEnv(),
      });
      expect(psAfterStop.exitCode, psAfterStop.stderr).toBe(0);
      const afterStop = parseJson(psAfterStop.stdout, LocalWorkspaceListEnvelope).data;
      const oursAfterStop = afterStop.find((entry) => entry.workspace_id === FIRST_WORKSPACE_ID);
      expect(oursAfterStop).toEqual({
        workspace_id: FIRST_WORKSPACE_ID,
        workspace_name: WORKSPACE_NAME,
        state: "exited",
        url: null,
      });

      // 7. Remove tears down the container + the app-db volume.
      const remove = await runCli({
        args: ["workspace", "remove", String(FIRST_WORKSPACE_ID), "--yes", "--full", "--json"],
        configHome: await pushConfigHome(),
        env: authEnv(),
        timeoutMs: 60_000,
      });
      expect(remove.exitCode, remove.stderr).toBe(0);
      const removeResult = parseJson(remove.stdout, RemoveResult);
      expect(removeResult).toEqual({
        workspace_id: FIRST_WORKSPACE_ID,
        container_name: `metabase-workspace-${FIRST_WORKSPACE_ID}`,
        volume_name: `metabase-workspace-${FIRST_WORKSPACE_ID}-appdb`,
        removed_container: true,
        removed_volume: true,
      });

      // 8. ps should no longer list the workspace.
      const psAfterRemove = await runCli({
        args: ["workspace", "ps", "--full", "--json"],
        configHome: await pushConfigHome(),
        env: authEnv(),
      });
      expect(psAfterRemove.exitCode, psAfterRemove.stderr).toBe(0);
      const afterRemove = parseJson(psAfterRemove.stdout, LocalWorkspaceListEnvelope).data;
      expect(
        afterRemove.find((entry) => entry.workspace_id === FIRST_WORKSPACE_ID),
      ).toBeUndefined();
    },
    HEALTH_TIMEOUT_MS + 60_000,
  );
});

async function listMetabaseTempDirs(): Promise<string[]> {
  const entries = await readdir(tmpdir());
  return entries.filter((entry) => entry.startsWith("metabase-workspace-"));
}
