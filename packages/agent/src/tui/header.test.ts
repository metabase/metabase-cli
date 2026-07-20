import { createClient } from "@metabase/cli/client";
import { expect, test } from "vitest";
import { MetabaseAccess } from "../metabase/access";
import type { MetabaseConnection } from "../metabase/connection";
import type { InstanceContext } from "../metabase/probe";
import { instanceSummary } from "./header";

const URL = "https://metabase.example.com";

const INSTANCE: InstanceContext = {
  url: URL,
  versionTag: "v1.63.0",
  majorVersion: 63,
  edition: "enterprise",
  tokenFeatures: ["transforms"],
  user: { id: 1, email: "ada@example.com", common_name: "Ada Lovelace", is_superuser: true },
};

const UNPROBED: InstanceContext = {
  url: URL,
  versionTag: null,
  majorVersion: null,
  edition: null,
  tokenFeatures: null,
  user: null,
};

function connection(): MetabaseConnection {
  return {
    client: createClient({ url: URL, credential: { kind: "apiKey", apiKey: "mb_key" } }),
    url: URL,
    profile: "default",
  };
}

test("names the instance, who the agent is signed in as, and the build it reaches", () => {
  const access = new MetabaseAccess(connection(), INSTANCE);

  expect(instanceSummary(access)).toBe(
    "Connected to https://metabase.example.com as Ada Lovelace (v1.63.0 enterprise)",
  );
});

test("points a session that has no credential at /mb-login", () => {
  const access = new MetabaseAccess(null);

  expect(instanceSummary(access)).toBe(
    "Not signed in — run /mb-login <url> to sign in through the browser.",
  );
});

test("drops the facts the probe could not establish rather than naming them empty", () => {
  const access = new MetabaseAccess(connection(), UNPROBED);

  expect(instanceSummary(access)).toBe("Connected to https://metabase.example.com");
});
