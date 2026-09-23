import { z } from "zod";

import { errorMessage } from "@metabase/client/errors";

import { assertNever } from "../contracts/assert-never";
import type { UpdateState, UpdateStep } from "../contracts/updates";

// Names a generic feed (a directory holding `latest-linux.yml` and the artifacts) in place of the
// GitHub releases `electron-builder.yml` publishes to; the release smoke points it at a mock server.
export const UPDATE_FEED_ENV_VAR = "RDE_UPDATE_FEED";

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const UPDATER_EVENTS = [
  "checking-for-update",
  "update-available",
  "update-not-available",
  "download-progress",
  "update-downloaded",
  "error",
] as const;

type UpdaterEvent = (typeof UPDATER_EVENTS)[number];

// The slice of electron-updater's `autoUpdater` the app drives, so the state machine runs in a test
// without Electron.
export interface Updater {
  readonly active: () => boolean;
  readonly setFeed: (url: string) => void;
  readonly check: () => Promise<unknown>;
  readonly download: () => Promise<unknown>;
  readonly install: () => void;
  readonly on: (event: UpdaterEvent, listener: (payload: unknown) => void) => void;
}

const UpdateInfo = z.object({ version: z.string().min(1) }).loose();
const ProgressInfo = z.object({ percent: z.number() }).loose();

const MAX_PERCENT = 100;

export interface AppUpdatesDeps {
  readonly updater: Updater;
  readonly testMode: boolean;
  readonly env: NodeJS.ProcessEnv;
  readonly publish: (state: UpdateState) => void;
  readonly log: (message: string) => void;
}

function initialState(deps: AppUpdatesDeps): UpdateState {
  if (deps.testMode) {
    return { kind: "off", reason: "test-mode" };
  }
  if (!deps.updater.active()) {
    return { kind: "off", reason: "not-installed" };
  }
  return { kind: "idle" };
}

export class AppUpdates {
  readonly #deps: AppUpdatesDeps;
  #state: UpdateState;
  #timer: NodeJS.Timeout | null = null;

  constructor(deps: AppUpdatesDeps) {
    this.#deps = deps;
    this.#state = initialState(deps);
  }

  state(): UpdateState {
    return this.#state;
  }

  start(): void {
    if (this.#state.kind === "off") {
      this.#deps.log(`updates: off (${this.#state.reason})`);
      return;
    }
    const feed = this.#deps.env[UPDATE_FEED_ENV_VAR];
    if (feed !== undefined) {
      this.#deps.updater.setFeed(feed);
      this.#deps.log(`updates: feed ${feed}`);
    }
    for (const event of UPDATER_EVENTS) {
      this.#deps.updater.on(event, (payload) => {
        this.#receive(event, payload);
      });
    }
    void this.check();
    this.#timer = setInterval(() => {
      void this.check();
    }, CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  // A check while a download runs or waits to install would replace what the user is acting on.
  async check(): Promise<UpdateState> {
    const kind = this.#state.kind;
    if (kind === "off" || kind === "checking" || kind === "downloading" || kind === "ready") {
      return this.#state;
    }
    await this.#run("check", () => this.#deps.updater.check());
    return this.#state;
  }

  async download(): Promise<UpdateState> {
    const current = this.#state;
    if (current.kind !== "available") {
      return current;
    }
    this.#set({ kind: "downloading", version: current.version, percent: 0 });
    await this.#run("download", () => this.#deps.updater.download());
    return this.#state;
  }

  install(): UpdateState {
    if (this.#state.kind === "ready") {
      this.#deps.updater.install();
    }
    return this.#state;
  }

  async #run(step: UpdateStep, action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
    } catch (error) {
      this.#fail(step, errorMessage(error));
    }
  }

  #receive(event: UpdaterEvent, payload: unknown): void {
    switch (event) {
      case "checking-for-update": {
        this.#set({ kind: "checking" });
        return;
      }
      case "update-available": {
        this.#set({ kind: "available", version: UpdateInfo.parse(payload).version });
        return;
      }
      case "update-not-available": {
        this.#set({ kind: "current", version: UpdateInfo.parse(payload).version });
        return;
      }
      case "download-progress": {
        this.#progress(ProgressInfo.parse(payload).percent);
        return;
      }
      case "update-downloaded": {
        this.#set({ kind: "ready", version: UpdateInfo.parse(payload).version });
        return;
      }
      case "error": {
        this.#fail(
          this.#state.kind === "downloading" ? "download" : "check",
          errorMessage(payload),
        );
        return;
      }
      default: {
        assertNever(event);
      }
    }
  }

  #progress(percent: number): void {
    const current = this.#state;
    if (current.kind !== "downloading") {
      return;
    }
    this.#set({ ...current, percent: Math.min(MAX_PERCENT, Math.max(0, percent)) });
  }

  // electron-updater reports one failure twice, as an `error` event and as the rejected promise,
  // so the second report of the same failure changes nothing.
  #fail(step: UpdateStep, message: string): void {
    const current = this.#state;
    if (current.kind === "error" && current.step === step && current.message === message) {
      return;
    }
    this.#deps.log(`updates: ${step} failed: ${message}`);
    this.#set({ kind: "error", step, message });
  }

  #set(state: UpdateState): void {
    this.#state = state;
    this.#deps.publish(state);
  }
}
