import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createServerProfile } from "@metabase/client/version/profile";

const hoisted = vi.hoisted(() => ({
  store: new Map<string, string>(),
  controls: { broken: false },
}));

vi.mock("@napi-rs/keyring", async () => {
  const { createKeyringMockModule } = await import("./keyring-mock");
  return createKeyringMockModule(hoisted);
});

import { readCachedServerProfile } from "./cached-server";
import { writeProfile } from "./storage";
import {
  probeAt,
  seedProbedProfile,
  setupTempConfigHome,
  type TempConfigHome,
} from "./temp-config-home";

describe("readCachedServerProfile", () => {
  let home: TempConfigHome;

  beforeEach(() => {
    hoisted.store.clear();
    home = setupTempConfigHome();
  });

  afterEach(() => {
    home.cleanup();
  });

  it("returns null when the profile has no record", async () => {
    expect(await readCachedServerProfile("default")).toBeNull();
  });

  it("returns null when the record was never probed", async () => {
    await writeProfile({ url: "http://127.0.0.1:1", apiKey: "secret-key" }, "default");

    expect(await readCachedServerProfile("default")).toBeNull();
  });

  it("derives the profile from the record's cached probe", async () => {
    await seedProbedProfile("staging", probeAt(61, { library: true }));

    expect(await readCachedServerProfile("staging")).toEqual(
      createServerProfile(probeAt(61, { library: true })),
    );
  });
});
