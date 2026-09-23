import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { formatZodIssue, isFileNotFoundError } from "@metabase/client/errors";
import { parseJsonResult } from "@metabase/client/json";

import type { SessionEvent } from "../../contracts/events";
import {
  SESSION_STORE_VERSION,
  SessionIndex,
  SessionIndexV1,
  type SessionIndexEntry,
  type SessionIndexEntryV1,
} from "../../contracts/session";
import { USER_ONLY_FILE_MODE, writeFileAtomically } from "../atomic-file";

import { EVENTS_FILE_NAME, appendSessionLog, readSessionLog } from "./log";

export const SESSIONS_DIR_NAME = "sessions";
export const INDEX_FILE_NAME = "index.json";

const INDEX_INDENT = 2;
const GENERATION_WITHOUT_PINNED = 1;

export class SessionStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionStoreError";
  }
}

const EMPTY_INDEX: SessionIndex = { version: SESSION_STORE_VERSION, sessions: [] };

const IndexGeneration = z.object({ version: z.number().int() }).loose();

function parseOrFail<Value>(schema: z.ZodType<Value>, raw: unknown, source: string): Value {
  const parsed = schema.safeParse(raw);
  if (parsed.success) {
    return parsed.data;
  }
  const issues = parsed.error.issues.map(formatZodIssue).join("; ");
  throw new SessionStoreError(`${source}: ${issues}`);
}

function unpinned(entry: SessionIndexEntryV1): SessionIndexEntry {
  return { ...entry, pinned: false };
}

function migrateWithoutPinned(raw: unknown, source: string): SessionIndex {
  const previous = parseOrFail(SessionIndexV1, raw, source);
  return { version: SESSION_STORE_VERSION, sessions: previous.sessions.map(unpinned) };
}

function decodeIndex(raw: unknown, source: string): SessionIndex {
  const generation = IndexGeneration.safeParse(raw);
  if (!generation.success) {
    return parseOrFail(SessionIndex, raw, source);
  }
  const version = generation.data.version;
  if (version === GENERATION_WITHOUT_PINNED) {
    return migrateWithoutPinned(raw, source);
  }
  if (version !== SESSION_STORE_VERSION) {
    throw new SessionStoreError(
      `${source}: session store version ${version} was written by a newer RDE (this one reads ${SESSION_STORE_VERSION})`,
    );
  }
  return parseOrFail(SessionIndex, raw, source);
}

async function readIndexFile(path: string): Promise<SessionIndex> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return EMPTY_INDEX;
    }
    throw error;
  }
  const parsed = parseJsonResult(text, z.unknown(), { source: path });
  if (!parsed.ok) {
    throw new SessionStoreError(parsed.error.message);
  }
  return decodeIndex(parsed.value, path);
}

export class SessionStore {
  private entries: readonly SessionIndexEntry[];

  private constructor(
    private readonly root: string,
    entries: readonly SessionIndexEntry[],
  ) {
    this.entries = entries;
  }

  static async open(userDataDirectory: string): Promise<SessionStore> {
    const root = join(userDataDirectory, SESSIONS_DIR_NAME);
    await mkdir(root, { recursive: true });
    const index = await readIndexFile(join(root, INDEX_FILE_NAME));
    return new SessionStore(root, index.sessions);
  }

  index(): SessionIndex {
    return { version: SESSION_STORE_VERSION, sessions: [...this.entries] };
  }

  entry(sessionId: string): SessionIndexEntry | null {
    return this.entries.find((candidate) => candidate.id === sessionId) ?? null;
  }

  directoryOf(sessionId: string): string {
    return join(this.root, sessionId);
  }

  async record(entry: SessionIndexEntry): Promise<SessionIndex> {
    await mkdir(this.directoryOf(entry.id), { recursive: true });
    const without = this.entries.filter((candidate) => candidate.id !== entry.id);
    return this.writeIndex([entry, ...without]);
  }

  async setPinned(sessionId: string, pinned: boolean): Promise<SessionIndex> {
    return this.writeIndex(
      this.entries.map((candidate) =>
        candidate.id === sessionId ? { ...candidate, pinned } : candidate,
      ),
    );
  }

  async forget(sessionId: string): Promise<SessionIndex> {
    const index = await this.writeIndex(
      this.entries.filter((candidate) => candidate.id !== sessionId),
    );
    await rm(this.directoryOf(sessionId), { recursive: true, force: true });
    return index;
  }

  readEvents(sessionId: string): Promise<SessionEvent[]> {
    return readSessionLog(this.logPath(sessionId));
  }

  appendEvents(sessionId: string, events: readonly SessionEvent[]): Promise<void> {
    return appendSessionLog(this.logPath(sessionId), events);
  }

  private logPath(sessionId: string): string {
    return join(this.directoryOf(sessionId), EVENTS_FILE_NAME);
  }

  private async writeIndex(entries: readonly SessionIndexEntry[]): Promise<SessionIndex> {
    const index: SessionIndex = { version: SESSION_STORE_VERSION, sessions: [...entries] };
    const contents = `${JSON.stringify(index, null, INDEX_INDENT)}\n`;
    await writeFileAtomically(join(this.root, INDEX_FILE_NAME), contents, USER_ONLY_FILE_MODE);
    this.entries = index.sessions;
    return index;
  }
}
