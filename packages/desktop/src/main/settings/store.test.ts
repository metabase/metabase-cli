import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { parseJson } from "@metabase/client/json";

import type { SettingsV1, SettingsV2, SettingsV3 } from "../../contracts/settings";

import { SETTINGS_FILE_NAME, SettingsFileError, SettingsStore, defaultSettings } from "./store";

const directories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "rde-settings-"));
  directories.push(directory);
  return directory;
}

async function withSettingsFile(contents: string): Promise<string> {
  const directory = await temporaryDirectory();
  await writeFile(join(directory, SETTINGS_FILE_NAME), contents, "utf8");
  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
  directories.length = 0;
});

describe("SettingsStore.open", () => {
  it("returns the defaults when no file exists yet", async () => {
    const store = await SettingsStore.open(await temporaryDirectory());

    expect(store.current()).toEqual({
      version: 6,
      metabase: null,
      repository: null,
      worktreeRoot: null,
      editor: null,
      providers: {
        claude: { enabled: true, binaryPath: null },
        codex: { enabled: true, binaryPath: null },
      },
      theme: "system",
      layout: { sidebar: 256, sidePanel: 560, tree: 224 },
      agents: { models: { claude: "opus", codex: "gpt-6-astra" }, permissionMode: "ask" },
    });
  });

  it("migrates an unversioned file by keeping its theme and defaulting the rest", async () => {
    const directory = await withSettingsFile(JSON.stringify({ theme: "dark", windowBounds: {} }));

    const store = await SettingsStore.open(directory);

    expect(store.current()).toEqual({ ...defaultSettings(), theme: "dark" });
  });

  it("migrates a file written before the worktree root by leaving that root unchosen", async () => {
    const {
      worktreeRoot: _dropped,
      editor: _absent,
      layout: _none,
      agents: _unset,
      ...rest
    } = defaultSettings();
    const previous: SettingsV1 = { ...rest, version: 1, theme: "dark" };
    const directory = await withSettingsFile(JSON.stringify(previous));

    const store = await SettingsStore.open(directory);

    expect(store.current()).toEqual({ ...defaultSettings(), theme: "dark", worktreeRoot: null });
  });

  it("migrates a file written before the editor setting by opening files the system's way", async () => {
    const { editor: _absent, layout: _none, agents: _unset, ...rest } = defaultSettings();
    const previous: SettingsV2 = { ...rest, version: 2, worktreeRoot: "/work/trees" };
    const directory = await withSettingsFile(JSON.stringify(previous));

    const store = await SettingsStore.open(directory);

    expect(store.current()).toEqual({ ...defaultSettings(), worktreeRoot: "/work/trees" });
  });

  it("migrates a file written before the panel widths by giving each panel its initial width", async () => {
    const { layout: _none, agents: _unset, ...rest } = defaultSettings();
    const previous: SettingsV3 = { ...rest, version: 3, editor: "code" };
    const directory = await withSettingsFile(JSON.stringify(previous));

    const store = await SettingsStore.open(directory);

    expect(store.current()).toEqual({ ...defaultSettings(), editor: "code" });
  });

  it("refuses a file whose version it does not read", async () => {
    const directory = await withSettingsFile(JSON.stringify({ version: 7, theme: "dark" }));

    await expect(SettingsStore.open(directory)).rejects.toThrow(
      "settings version 7 was written by a newer RDE (this one reads 6)",
    );
  });

  it("refuses a file that is not JSON", async () => {
    const directory = await withSettingsFile("{");

    const rejection = SettingsStore.open(directory);

    await expect(rejection).rejects.toBeInstanceOf(SettingsFileError);
    await expect(rejection).rejects.toThrow("invalid JSON");
  });

  it("refuses a versioned file whose fields do not match, rather than migrating it away", async () => {
    const directory = await withSettingsFile(JSON.stringify({ version: 1, theme: "neon" }));

    const rejection = SettingsStore.open(directory);

    await expect(rejection).rejects.toBeInstanceOf(SettingsFileError);
    await expect(rejection).rejects.toThrow("theme:");
  });
});

describe("SettingsStore.update", () => {
  it("writes the settings and leaves no temporary file behind", async () => {
    const directory = await temporaryDirectory();
    const store = await SettingsStore.open(directory);

    await store.update((current) => ({ ...current, theme: "light" }));

    expect(await readdir(directory)).toEqual([SETTINGS_FILE_NAME]);
    const written = parseJson(await readFile(store.path, "utf8"), z.unknown());
    expect(written).toEqual({ ...defaultSettings(), theme: "light" });
  });

  it("is what the next open reads", async () => {
    const directory = await temporaryDirectory();
    const store = await SettingsStore.open(directory);
    await store.update((current) => ({ ...current, theme: "dark" }));

    const reopened = await SettingsStore.open(directory);

    expect(reopened.current()).toEqual({ ...defaultSettings(), theme: "dark" });
  });

  it("applies a burst of changes in the order they were asked for, each over the last", async () => {
    const directory = await temporaryDirectory();
    const store = await SettingsStore.open(directory);

    await Promise.all([
      store.update((current) => ({ ...current, theme: "dark" })),
      store.update((current) => ({
        ...current,
        layout: { sidebar: 300, sidePanel: 500, tree: 240 },
      })),
      store.update((current) => ({ ...current, layout: { ...current.layout, sidebar: 320 } })),
    ]);

    const reopened = await SettingsStore.open(directory);
    expect(reopened.current()).toEqual({
      ...defaultSettings(),
      theme: "dark",
      layout: { sidebar: 320, sidePanel: 500, tree: 240 },
    });
  });
});
