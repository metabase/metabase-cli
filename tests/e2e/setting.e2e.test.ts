import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { SettingListEnvelope } from "../../src/commands/setting/list";
import { createClient, type Client } from "../../src/core/http/client";
import { SettingValue } from "../../src/domain/setting";
import { parseJson } from "../../src/runtime/json";

const IntegerSettingValue = SettingValue.extend({ value: z.number().int() });
const NumberSettingValue = SettingValue.extend({ value: z.number() });
const StringArraySettingValue = SettingValue.extend({ value: z.array(z.string()) });

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";

const MUTABLE_KEY = "enable-public-sharing";
const MUTABLE_KEY_ENV_NAME = "MB_ENABLE_PUBLIC_SHARING";

describe("setting e2e", () => {
  let bootstrap: E2EBootstrap;
  let adminClient: Client;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    bootstrap = await readBootstrap();
    adminClient = createClient({ url: bootstrap.baseUrl, apiKey: bootstrap.adminApiKey });
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
      METABASE_URL: bootstrap.baseUrl,
      METABASE_API_KEY: bootstrap.adminApiKey,
    };
  }

  async function writeMutableKey(value: unknown): Promise<void> {
    await adminClient.requestRaw(`/api/setting/${MUTABLE_KEY}`, {
      method: "PUT",
      body: { value },
      expectContentType: "binary",
    });
  }

  it("list returns a parseable envelope including a stable admin-visible setting", async () => {
    await writeMutableKey(false);

    const result = await runCli({
      args: ["setting", "list", "--json", "--max-bytes", "0"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const envelope = parseJson(result.stdout, SettingListEnvelope);
    expect(envelope.returned).toBe(envelope.data.length);
    expect(envelope.total).toBe(envelope.data.length);
    expect(envelope.data.find((row) => row.key === MUTABLE_KEY)).toEqual({
      key: MUTABLE_KEY,
      value: false,
      is_env_setting: false,
      env_name: MUTABLE_KEY_ENV_NAME,
    });
  });

  it("get wraps the bare value in {key, value} for an unset setting (default)", async () => {
    const result = await runCli({
      args: ["setting", "get", MUTABLE_KEY, "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, SettingValue)).toEqual({
      key: MUTABLE_KEY,
      value: null,
    });
  });

  it("set with a positional JSON value persists, then get reflects the new value", async () => {
    const setResult = await runCli({
      args: ["setting", "set", MUTABLE_KEY, "false", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(setResult.exitCode, setResult.stderr).toBe(0);
    expect(parseJson(setResult.stdout, SettingValue)).toEqual({
      key: MUTABLE_KEY,
      value: false,
    });

    const getResult = await runCli({
      args: ["setting", "get", MUTABLE_KEY, "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(getResult.exitCode, getResult.stderr).toBe(0);
    expect(parseJson(getResult.stdout, SettingValue)).toEqual({
      key: MUTABLE_KEY,
      value: false,
    });
  });

  it("set with stdin reads the JSON value from the pipe", async () => {
    const setResult = await runCli({
      args: ["setting", "set", MUTABLE_KEY, "--json"],
      stdin: "false",
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(setResult.exitCode, setResult.stderr).toBe(0);
    expect(parseJson(setResult.stdout, SettingValue)).toEqual({
      key: MUTABLE_KEY,
      value: false,
    });

    const getResult = await runCli({
      args: ["setting", "get", MUTABLE_KEY, "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(getResult.exitCode, getResult.stderr).toBe(0);
    expect(parseJson(getResult.stdout, SettingValue)).toEqual({
      key: MUTABLE_KEY,
      value: false,
    });
  });

  it("set null deletes the override; get returns null again", async () => {
    await writeMutableKey(false);

    const setResult = await runCli({
      args: ["setting", "set", MUTABLE_KEY, "null", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(setResult.exitCode, setResult.stderr).toBe(0);
    expect(parseJson(setResult.stdout, SettingValue)).toEqual({
      key: MUTABLE_KEY,
      value: null,
    });

    const getResult = await runCli({
      args: ["setting", "get", MUTABLE_KEY, "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(getResult.exitCode, getResult.stderr).toBe(0);
    expect(parseJson(getResult.stdout, SettingValue)).toEqual({
      key: MUTABLE_KEY,
      value: null,
    });
  });

  it("set rejects a bareword value (not valid JSON) with ConfigError", async () => {
    const result = await runCli({
      args: ["setting", "set", MUTABLE_KEY, "bareword", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(`setting ${MUTABLE_KEY} value: invalid JSON`);
    expect(result.stdout).toBe("");
  });

  it("set with no value, no --file, and no piped stdin fails with ConfigError", async () => {
    const result = await runCli({
      args: ["setting", "set", MUTABLE_KEY, "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      "input required: provide one of flag, --file, stdin, or positional argument",
    );
    expect(result.stdout).toBe("");
  });

  it("set rejects multiple body sources (positional + --file)", async () => {
    const result = await runCli({
      args: [
        "setting",
        "set",
        MUTABLE_KEY,
        "false",
        "--file",
        "/tmp/does-not-matter.json",
        "--json",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      "multiple body sources given (--file, positional); pass exactly one",
    );
    expect(result.stdout).toBe("");
  });

  it("set with an invalid setting key (regex fail) fails with ConfigError", async () => {
    const result = await runCli({
      args: ["setting", "set", "..bad..", "true", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      'invalid setting key: "..bad.." (expected kebab-case identifier)',
    );
    expect(result.stdout).toBe("");
  });

  it("get --json on a string-valued setting wraps the bare server response", async () => {
    const STRING_KEY = "remote-sync-type";
    const TARGET = "read-write";
    try {
      await adminClient.requestRaw(`/api/setting/${STRING_KEY}`, {
        method: "PUT",
        body: { value: TARGET },
        expectContentType: "binary",
      });

      const result = await runCli({
        args: ["setting", "get", STRING_KEY, "--json"],
        configHome: await makeIsolatedConfigHome(),
        env: authEnv(),
      });

      expect(result.exitCode, result.stderr).toBe(0);
      expect(parseJson(result.stdout, SettingValue)).toEqual({
        key: STRING_KEY,
        value: TARGET,
      });
    } finally {
      await adminClient.requestRaw(`/api/setting/${STRING_KEY}`, {
        method: "PUT",
        body: { value: null },
        expectContentType: "binary",
      });
    }
  });

  it("get --json on a text/plain string setting (admin-email) returns the wrapped string", async () => {
    const result = await runCli({
      args: ["setting", "get", "admin-email", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, SettingValue)).toEqual({
      key: "admin-email",
      value: bootstrap.admin.email,
    });
  });

  it("get --json on an integer setting (active-users-count) returns a JSON number", async () => {
    const result = await runCli({
      args: ["setting", "get", "active-users-count", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const parsed = parseJson(result.stdout, IntegerSettingValue);
    expect(parsed.key).toBe("active-users-count");
    expect(parsed.value).toBeGreaterThanOrEqual(1);
  });

  it("get --json on a float setting (startup-time-millis) returns a JSON number", async () => {
    const result = await runCli({
      args: ["setting", "get", "startup-time-millis", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const parsed = parseJson(result.stdout, NumberSettingValue);
    expect(parsed.key).toBe("startup-time-millis");
    expect(parsed.value).toBeGreaterThan(0);
  });

  it("get --json on a JSON-object setting (custom-geojson) returns the parsed object", async () => {
    const result = await runCli({
      args: ["setting", "get", "custom-geojson", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, SettingValue)).toEqual({
      key: "custom-geojson",
      value: {
        us_states: {
          name: "United States",
          url: "app/assets/geojson/us-states.json",
          region_key: "STATE",
          region_name: "NAME",
          builtin: true,
        },
        world_countries: {
          name: "World",
          url: "app/assets/geojson/world.json",
          region_key: "ISO_A2",
          region_name: "NAME",
          builtin: true,
        },
      },
    });
  });

  it("get --json on a JSON-array setting (available-fonts) returns the parsed array", async () => {
    const result = await runCli({
      args: ["setting", "get", "available-fonts", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const parsed = parseJson(result.stdout, StringArraySettingValue);
    expect(parsed.key).toBe("available-fonts");
    expect(parsed.value).toEqual(expect.arrayContaining(["Lato", "Roboto"]));
  });

  it("get with an invalid setting key (regex fail) fails with ConfigError", async () => {
    const result = await runCli({
      args: ["setting", "get", "..bad..", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      'invalid setting key: "..bad.." (expected kebab-case identifier)',
    );
    expect(result.stdout).toBe("");
  });

  it("get with a server-unknown setting key surfaces the backend's Unknown setting error", async () => {
    const result = await runCli({
      args: ["setting", "get", "definitely-not-a-real-setting", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown setting: :definitely-not-a-real-setting");
    expect(result.stdout).toBe("");
  });

  it("set against a server-unknown setting key surfaces the backend's Unknown setting error", async () => {
    const result = await runCli({
      args: ["setting", "set", "definitely-not-a-real-setting", "true", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown setting: :definitely-not-a-real-setting");
    expect(result.stdout).toBe("");
  });
});
