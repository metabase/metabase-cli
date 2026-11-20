// Writes the command reference into `docs/commands/`, which it owns: the folder is removed and
// written again from the command tree and `docs/command-notes/`. `command-reference.test.ts` fails
// until the committed pages match what this writes.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SHARED_FLAG_SETS } from "../packages/cli/src/commands/flags";
import main from "../packages/cli/src/main";
import {
  NOTES_DIR,
  REFERENCE_DIR,
  renderCommandReference,
} from "../packages/cli/src/output/command-reference";
import { readMarkdownFiles } from "../packages/cli/src/runtime/markdown-files";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function generate(): Promise<void> {
  const outDir = join(REPO_ROOT, REFERENCE_DIR);
  const notes = await readMarkdownFiles(join(REPO_ROOT, NOTES_DIR));
  const pages = await renderCommandReference({
    root: main,
    sharedFlagSets: SHARED_FLAG_SETS,
    notes,
  });
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await Promise.all([...pages].map(([name, text]) => writeFile(join(outDir, name), text, "utf8")));
  process.stdout.write(`Wrote ${pages.size} pages to ${REFERENCE_DIR}\n`);
}

await generate();
