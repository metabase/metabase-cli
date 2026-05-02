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

import licenseRemoveCommand from "./remove";
import { readLicense, writeLicense } from "../../core/auth/storage";
import { setupTempConfigHome, type TempConfigHome } from "../../core/auth/temp-config-home";

describe("license remove command", () => {
  let home: TempConfigHome;

  beforeEach(() => {
    hoisted.store.clear();
    home = setupTempConfigHome();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    home.cleanup();
  });

  it("--yes clears the token", async () => {
    await writeLicense("token");
    expect(await readLicense()).toBe("token");

    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runCommand(licenseRemoveCommand, { rawArgs: ["--yes"] });
    expect(await readLicense()).toBeNull();
  });
});
