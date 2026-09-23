import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export const USER_ONLY_FILE_MODE = 0o600;

// The temporary file is created in the destination's own directory so the rename that publishes it
// stays within one filesystem, where it is atomic.
export async function writeFileAtomically(
  path: string,
  contents: string,
  mode: number,
): Promise<void> {
  const temporary = join(dirname(path), `${basename(path)}.${randomUUID()}.tmp`);
  await writeFile(temporary, contents, { encoding: "utf8", mode });
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
