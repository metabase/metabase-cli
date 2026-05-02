import { runCommand } from "citty";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  store: new Map<string, string>(),
  controls: { broken: false },
}));

vi.mock("@napi-rs/keyring", async () => {
  const { createKeyringMockModule } = await import("../../core/auth/keyring-mock");
  return createKeyringMockModule(hoisted);
});

import logoutCommand from "./logout";
import { readProfile, writeProfile } from "../../core/auth/storage";
import { setupTempConfigHome, type TempConfigHome } from "../../core/auth/temp-config-home";

describe("auth logout command", () => {
  let home: TempConfigHome;

  beforeEach(() => {
    hoisted.store.clear();
    home = setupTempConfigHome();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    home.cleanup();
  });

  it("--yes clears the profile", async () => {
    await writeProfile({ url: "https://m.example.com", apiKey: "secret" });
    expect(await readProfile()).not.toBeNull();

    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runCommand(logoutCommand, { rawArgs: ["--profile", "default", "--yes"] });
    expect(await readProfile()).toBeNull();
  });
});
