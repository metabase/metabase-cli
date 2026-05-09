import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";

import { z } from "zod";

import { parseJson } from "../../runtime/json";
import { isNotFoundError } from "../errors";
import { configDir } from "../paths";

const REJECTIONS_FILE = "rejections.json";
const REJECTIONS_FILE_MODE = 0o600;
const REJECTIONS_DIR_MODE = 0o700;

export const RejectionRecord = z.object({
  reason: z.string(),
  url: z.string(),
  rejectedAt: z.string(),
});
export type RejectionRecordValue = z.infer<typeof RejectionRecord>;

const RejectionsFileSchema = z.record(z.string(), RejectionRecord);

export function rejectionsFilePath(): string {
  return join(configDir(), REJECTIONS_FILE);
}

async function readRejectionsFile(): Promise<Record<string, RejectionRecordValue>> {
  const path = rejectionsFilePath();
  let raw: string;
  try {
    raw = await fs.readFile(path, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      return {};
    }
    throw error;
  }
  return parseJson(raw, RejectionsFileSchema, { source: path });
}

async function writeRejectionsFile(store: Record<string, RejectionRecordValue>): Promise<void> {
  const path = rejectionsFilePath();
  if (Object.keys(store).length === 0) {
    await fs.unlink(path).catch(() => undefined);
    return;
  }
  await fs.mkdir(dirname(path), { recursive: true, mode: REJECTIONS_DIR_MODE });
  await fs.writeFile(path, JSON.stringify(store, null, 2) + "\n", {
    mode: REJECTIONS_FILE_MODE,
  });
  if (process.platform !== "win32") {
    await fs.chmod(path, REJECTIONS_FILE_MODE);
  }
}

export interface RecordRejectionInput {
  reason: string;
  url: string;
}

export async function recordRejection(profile: string, input: RecordRejectionInput): Promise<void> {
  const store = await readRejectionsFile();
  store[profile] = {
    reason: input.reason,
    url: input.url,
    rejectedAt: new Date().toISOString(),
  };
  await writeRejectionsFile(store);
}

export async function clearRejection(profile: string): Promise<boolean> {
  const store = await readRejectionsFile();
  if (!(profile in store)) {
    return false;
  }
  delete store[profile];
  await writeRejectionsFile(store);
  return true;
}

export async function readRejection(profile: string): Promise<RejectionRecordValue | null> {
  const store = await readRejectionsFile();
  return store[profile] ?? null;
}
