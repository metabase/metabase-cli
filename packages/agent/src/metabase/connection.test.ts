import { afterEach, beforeEach, expect, test } from "vitest";
import { createMetabaseConnection } from "./connection";

const CREDENTIAL_VARS = ["MB_URL", "MB_API_KEY", "MB_PROFILE", "MB_PROFILE_STORE"];

const inherited = new Map<string, string | undefined>();

beforeEach(() => {
  for (const name of CREDENTIAL_VARS) {
    inherited.set(name, process.env[name]);
    delete process.env[name];
  }
});

afterEach(() => {
  for (const [name, value] of inherited) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

test("resolves the credential from the environment, against the default profile", async () => {
  process.env["MB_URL"] = "http://localhost:13000/";
  process.env["MB_API_KEY"] = "mb_from_env";

  const connection = await createMetabaseConnection();

  expect(connection.url).toBe("http://localhost:13000");
  expect(connection.profile).toBe("default");
});

test("resolves a flag-named profile over the default", async () => {
  const connection = await createMetabaseConnection({
    profile: "ci",
    url: "http://localhost:13000",
    apiKey: "mb_from_flag",
  });

  expect(connection.url).toBe("http://localhost:13000");
  expect(connection.profile).toBe("ci");
});
