import { createClient } from "@metabase/cli/client";
import { ConfigError } from "@metabase/cli/errors";
import { expect, test } from "vitest";
import { z } from "zod";
import { MetabaseAccess } from "./access";
import type { MetabaseConnection } from "./connection";
import type { InstanceContext } from "./probe";

const Payload = z.object({ id: z.number() });

function connection(url: string): MetabaseConnection {
  return {
    client: createClient({ url, credential: { kind: "apiKey", apiKey: "mb_key" } }),
    url,
    profile: "default",
  };
}

const INSTANCE: InstanceContext = {
  url: "https://metabase.example.com",
  versionTag: "v1.63.0",
  majorVersion: 63,
  edition: "enterprise",
  tokenFeatures: [],
  user: { id: 1, email: "ada@example.com", common_name: "Ada Lovelace", is_superuser: true },
};

test("tells the model how to sign in instead of failing with a network error", async () => {
  const access = new MetabaseAccess(null);

  expect(access.authenticated()).toBe(false);
  expect(access.url()).toBeNull();
  await expect(access.client.requestParsed(Payload, "/api/user/current")).rejects.toThrowError(
    new ConfigError(
      "Not authenticated to Metabase. Run `/mb-login <url>` to sign in through the browser; the session then reaches the instance without restarting.",
    ),
  );
});

test("routes to the connection a login established, without rebuilding the tools that hold it", () => {
  const access = new MetabaseAccess(null);
  const client = access.client;

  access.adopt(connection("https://metabase.example.com"), INSTANCE);

  expect(access.client).toBe(client);
  expect(access.authenticated()).toBe(true);
  expect(access.url()).toBe("https://metabase.example.com");
  expect(access.instance()).toEqual(INSTANCE);
});
