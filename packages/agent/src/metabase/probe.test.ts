import { expect, test } from "vitest";
import { fakeClient } from "../tools/fake-client";
import { type InstanceContext, probeInstance } from "./probe";

const URL = "https://metabase.example.com/analytics";

interface ServerProperties {
  version: { tag: string };
  "token-features"?: Record<string, boolean>;
}

const USER = {
  id: 7,
  email: "ada@example.com",
  common_name: "Ada Lovelace",
  is_superuser: true,
};

function respondWith(properties: ServerProperties): (path: string) => unknown {
  return (path: string) => {
    if (path === "/api/session/properties") {
      return properties;
    }
    if (path === "/api/user/current") {
      return USER;
    }
    throw new Error(`unexpected path: ${path}`);
  };
}

async function probe(properties: ServerProperties): Promise<InstanceContext> {
  const { client } = fakeClient(respondWith(properties));
  return probeInstance(client, URL);
}

test("reports the version, the enabled paid features, and the acting user", async () => {
  const instance = await probe({
    version: { tag: "v1.58.4" },
    "token-features": { transforms: true, remote_sync: false, advanced_permissions: true },
  });

  expect(instance).toEqual({
    url: URL,
    versionTag: "v1.58.4",
    majorVersion: 58,
    edition: "enterprise",
    tokenFeatures: ["advanced_permissions", "transforms"],
    user: { id: 7, email: "ada@example.com", common_name: "Ada Lovelace", is_superuser: true },
  });
});

test("reads a v0 tag as the OSS build, and a server without token features as having none", async () => {
  const instance = await probe({ version: { tag: "v0.58.4" } });

  expect(instance).toEqual({
    url: URL,
    versionTag: "v0.58.4",
    majorVersion: 58,
    edition: "oss",
    tokenFeatures: null,
    user: { id: 7, email: "ada@example.com", common_name: "Ada Lovelace", is_superuser: true },
  });
});

test("leaves version and edition unknown when the server's tag is not a Metabase version", async () => {
  const instance = await probe({ version: { tag: "vUNKNOWN" }, "token-features": {} });

  expect(instance).toEqual({
    url: URL,
    versionTag: null,
    majorVersion: null,
    edition: null,
    tokenFeatures: [],
    user: { id: 7, email: "ada@example.com", common_name: "Ada Lovelace", is_superuser: true },
  });
});

test("probes both endpoints once, and only those", async () => {
  const { client, requests } = fakeClient(respondWith({ version: { tag: "v0.58.4" } }));

  await probeInstance(client, URL);

  expect(requests.map((request) => request.path).toSorted()).toEqual([
    "/api/session/properties",
    "/api/user/current",
  ]);
});
