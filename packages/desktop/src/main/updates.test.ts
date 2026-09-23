import { afterEach, describe, expect, it } from "vitest";

import type { UpdateState } from "../contracts/updates";

import { AppUpdates, UPDATE_FEED_ENV_VAR, type Updater } from "./updates";

type Listener = (payload: unknown) => void;

const FEED = "http://127.0.0.1:4000/";
const NEXT = { version: "1.2.0", files: [], path: "rde-1.2.0.AppImage" };

interface FakeUpdaterOptions {
  readonly active: boolean;
  readonly check: (updater: FakeUpdater) => Promise<unknown>;
  readonly download: (updater: FakeUpdater) => Promise<unknown>;
}

class FakeUpdater {
  readonly feeds: string[] = [];
  readonly listeners = new Map<string, Listener>();
  checks = 0;
  installs = 0;

  constructor(private readonly options: FakeUpdaterOptions) {}

  emit(event: string, payload: unknown): void {
    const listener = this.listeners.get(event);
    if (listener === undefined) {
      throw new Error(`nothing listens for ${event}`);
    }
    listener(payload);
  }

  port(): Updater {
    return {
      active: () => this.options.active,
      setFeed: (url) => {
        this.feeds.push(url);
      },
      check: () => {
        this.checks += 1;
        return this.options.check(this);
      },
      download: () => this.options.download(this),
      install: () => {
        this.installs += 1;
      },
      on: (event, listener) => {
        this.listeners.set(event, listener);
      },
    };
  }
}

const running: AppUpdates[] = [];

afterEach(() => {
  for (const updates of running.splice(0)) {
    updates.stop();
  }
});

interface Harness {
  readonly updates: AppUpdates;
  readonly updater: FakeUpdater;
  readonly published: UpdateState[];
}

function harness(options: FakeUpdaterOptions, testMode: boolean, env: NodeJS.ProcessEnv): Harness {
  const updater = new FakeUpdater(options);
  const published: UpdateState[] = [];
  const updates = new AppUpdates({
    updater: updater.port(),
    testMode,
    env,
    publish: (state) => {
      published.push(state);
    },
    log: () => undefined,
  });
  running.push(updates);
  return { updates, updater, published };
}

function offers(version: typeof NEXT): (updater: FakeUpdater) => Promise<unknown> {
  return async (updater) => {
    updater.emit("checking-for-update", undefined);
    updater.emit("update-available", version);
    return { updateInfo: version };
  };
}

const neverDownloads: FakeUpdaterOptions["download"] = async () => {
  throw new Error("the test never downloads");
};

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

describe("AppUpdates", () => {
  it("stays off under test mode and never reaches the feed", async () => {
    const { updates, updater } = harness(
      { active: true, check: offers(NEXT), download: neverDownloads },
      true,
      {},
    );
    updates.start();
    expect([updates.state(), updater.checks, await updates.check()]).toEqual([
      { kind: "off", reason: "test-mode" },
      0,
      { kind: "off", reason: "test-mode" },
    ]);
  });

  it("stays off in a build that cannot replace itself", () => {
    const { updates } = harness(
      { active: false, check: offers(NEXT), download: neverDownloads },
      false,
      {},
    );
    expect(updates.state()).toEqual({ kind: "off", reason: "not-installed" });
  });

  it("checks the feed the environment names on start and reports what it offers", async () => {
    const { updates, updater, published } = harness(
      { active: true, check: offers(NEXT), download: neverDownloads },
      false,
      { [UPDATE_FEED_ENV_VAR]: FEED },
    );
    updates.start();
    await settle();
    expect([updater.feeds, published]).toEqual([
      [FEED],
      [{ kind: "checking" }, { kind: "available", version: "1.2.0" }],
    ]);
  });

  it("downloads on request, reports progress, and installs only once the download is in", async () => {
    const { updates, updater, published } = harness(
      {
        active: true,
        check: offers(NEXT),
        download: async (fake) => {
          fake.emit("download-progress", { percent: 40, bytesPerSecond: 1, total: 10 });
          fake.emit("update-downloaded", NEXT);
          return undefined;
        },
      },
      false,
      {},
    );
    updates.start();
    await settle();
    expect(updates.install()).toEqual({ kind: "available", version: "1.2.0" });
    await updates.download();
    updates.install();
    expect([published.slice(2), updater.installs]).toEqual([
      [
        { kind: "downloading", version: "1.2.0", percent: 0 },
        { kind: "downloading", version: "1.2.0", percent: 40 },
        { kind: "ready", version: "1.2.0" },
      ],
      1,
    ]);
  });

  it("records a failure reported both as an event and as a rejection once", async () => {
    const failure = new Error("net::ERR_INTERNET_DISCONNECTED");
    const { updates, published } = harness(
      {
        active: true,
        check: async (fake) => {
          fake.emit("checking-for-update", undefined);
          fake.emit("error", failure);
          throw failure;
        },
        download: neverDownloads,
      },
      false,
      {},
    );
    updates.start();
    await settle();
    expect(published).toEqual([
      { kind: "checking" },
      { kind: "error", step: "check", message: "net::ERR_INTERNET_DISCONNECTED" },
    ]);
  });

  it("names a failed download as the download's", async () => {
    const { updates } = harness(
      {
        active: true,
        check: offers(NEXT),
        download: async () => {
          throw new Error("sha512 checksum mismatch");
        },
      },
      false,
      {},
    );
    updates.start();
    await settle();
    expect(await updates.download()).toEqual({
      kind: "error",
      step: "download",
      message: "sha512 checksum mismatch",
    });
  });

  it("does not check again while a downloaded update waits for the restart", async () => {
    const { updates, updater } = harness(
      {
        active: true,
        check: offers(NEXT),
        download: async (fake) => {
          fake.emit("update-downloaded", NEXT);
          return undefined;
        },
      },
      false,
      {},
    );
    updates.start();
    await settle();
    await updates.download();
    expect([await updates.check(), updater.checks]).toEqual([
      { kind: "ready", version: "1.2.0" },
      1,
    ]);
  });
});
