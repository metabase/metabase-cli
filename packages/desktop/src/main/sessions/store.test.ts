import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SESSION_EVENT_FIXTURES } from "../../contracts/events.fixtures";
import { SessionLogError } from "../../contracts/projector";
import type { SessionIndexEntry, SessionIndexV1 } from "../../contracts/session";

import { EVENTS_FILE_NAME } from "./log";
import { INDEX_FILE_NAME, SESSIONS_DIR_NAME, SessionStore, SessionStoreError } from "./store";

const CREATED = SESSION_EVENT_FIXTURES["session.created"];
const STARTED = SESSION_EVENT_FIXTURES["turn.started"];

const ENTRY: SessionIndexEntry = {
  id: CREATED.sessionId,
  title: "Clean the orders table",
  provider: "claude",
  workspace: { kind: "worktree", path: "/repo/.rde/orders", branch: "rde/orders", base: "main" },
  lifecycle: "active",
  pinned: false,
  createdAt: CREATED.at,
  updatedAt: CREATED.at,
};

const V1_INDEX: SessionIndexV1 = {
  version: 1,
  sessions: [
    {
      id: ENTRY.id,
      title: ENTRY.title,
      provider: ENTRY.provider,
      workspace: ENTRY.workspace,
      lifecycle: ENTRY.lifecycle,
      createdAt: ENTRY.createdAt,
      updatedAt: ENTRY.updatedAt,
    },
  ],
};

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.map((path) => rm(path, { recursive: true, force: true })));
  directories.length = 0;
});

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "rde-sessions-"));
  directories.push(path);
  return path;
}

function logPath(userData: string, sessionId: string): string {
  return join(userData, SESSIONS_DIR_NAME, sessionId, EVENTS_FILE_NAME);
}

async function withIndexFile(contents: string): Promise<string> {
  const userData = await temporaryDirectory();
  await mkdir(join(userData, SESSIONS_DIR_NAME), { recursive: true });
  await writeFile(join(userData, SESSIONS_DIR_NAME, INDEX_FILE_NAME), contents, "utf8");
  return userData;
}

describe("SessionStore", () => {
  it("opens an empty index when the app has never run", async () => {
    const store = await SessionStore.open(await temporaryDirectory());

    expect(store.index()).toEqual({ version: 2, sessions: [] });
  });

  it("puts the newest session first so the sidebar reads in the order they were touched", async () => {
    const store = await SessionStore.open(await temporaryDirectory());
    const older: SessionIndexEntry = { ...ENTRY, id: "ses_older", title: "Older" };

    await store.record(older);
    await store.record(ENTRY);

    expect(store.index().sessions.map((entry) => entry.id)).toEqual([ENTRY.id, "ses_older"]);
  });

  it("reads back an index a previous run wrote", async () => {
    const userData = await temporaryDirectory();
    await (await SessionStore.open(userData)).record(ENTRY);

    expect((await SessionStore.open(userData)).index().sessions).toEqual([ENTRY]);
  });

  it("refuses an index written by a newer app rather than dropping what it cannot read", async () => {
    const userData = await withIndexFile(JSON.stringify({ version: 3, sessions: [] }));

    await expect(SessionStore.open(userData)).rejects.toThrow(SessionStoreError);
    await expect(SessionStore.open(userData)).rejects.toThrow(
      "session store version 3 was written by a newer RDE (this one reads 2)",
    );
  });

  it("reads an index a previous generation wrote, taking every session as unpinned", async () => {
    const userData = await withIndexFile(JSON.stringify(V1_INDEX));

    const store = await SessionStore.open(userData);

    expect(store.index()).toEqual({ version: 2, sessions: [ENTRY] });
  });

  it("pins a session where it stands, so the list keeps the order it was written in", async () => {
    const userData = await temporaryDirectory();
    const store = await SessionStore.open(userData);
    const older: SessionIndexEntry = { ...ENTRY, id: "ses_older", title: "Older" };
    await store.record(older);
    await store.record(ENTRY);

    const index = await store.setPinned(older.id, true);

    expect(index.sessions).toEqual([ENTRY, { ...older, pinned: true }]);
  });

  it("appends events as one JSON object per line and reads them back in order", async () => {
    const userData = await temporaryDirectory();
    const store = await SessionStore.open(userData);
    await store.record(ENTRY);

    await store.appendEvents(ENTRY.id, [CREATED]);
    await store.appendEvents(ENTRY.id, [STARTED]);

    const text = await readFile(logPath(userData, ENTRY.id), "utf8");
    expect(text.trimEnd().split("\n")).toHaveLength(2);
    expect(await store.readEvents(ENTRY.id)).toEqual([CREATED, STARTED]);
  });

  it("stops on a line it cannot read, naming which line it is", async () => {
    const userData = await temporaryDirectory();
    const store = await SessionStore.open(userData);
    await store.record(ENTRY);
    await store.appendEvents(ENTRY.id, [CREATED]);
    await writeFile(
      logPath(userData, ENTRY.id),
      `${JSON.stringify(CREATED)}\n{ not json\n`,
      "utf8",
    );

    const rejection = store.readEvents(ENTRY.id);
    await expect(rejection).rejects.toBeInstanceOf(SessionLogError);
    await expect(rejection).rejects.toThrow(`${EVENTS_FILE_NAME}:2`);
  });

  it("reads an empty log for a session that has recorded nothing yet", async () => {
    const store = await SessionStore.open(await temporaryDirectory());
    await store.record(ENTRY);

    expect(await store.readEvents(ENTRY.id)).toEqual([]);
  });

  it("takes a deleted session out of the index and off the disk", async () => {
    const userData = await temporaryDirectory();
    const store = await SessionStore.open(userData);
    await store.record(ENTRY);
    await store.appendEvents(ENTRY.id, [CREATED]);

    expect((await store.forget(ENTRY.id)).sessions).toEqual([]);
    await expect(readFile(logPath(userData, ENTRY.id), "utf8")).rejects.toThrow("ENOENT");
  });
});
