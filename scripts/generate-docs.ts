// Writes the command reference into `packages/cli/dist/docs/`, which it owns: the folder is
// removed and written again from the command tree and the guides beside it. The CLI build runs it
// after each bundle, so the pages ship in the npm package that the Metabase docs site copies them
// from. The folder is fixed rather than taken as an argument, so the removal can't reach another.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SHARED_FLAG_SETS } from "../packages/cli/src/commands/flags";
import { assertGuideCommands } from "../packages/cli/src/commands/guide-commands";
import { GUIDES_DIR, loadGuides } from "../packages/cli/src/core/guides";
import main from "../packages/cli/src/main";
import { renderCommandReference } from "../packages/cli/src/output/command-reference";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS_DIR = "packages/cli/dist/docs";

async function generate(): Promise<void> {
  const outDir = join(REPO_ROOT, DOCS_DIR);
  const guides = loadGuides(GUIDES_DIR);
  for (const guide of guides) {
    await assertGuideCommands(guide, main);
  }
  const pages = await renderCommandReference({
    root: main,
    sharedFlagSets: SHARED_FLAG_SETS,
    guides,
  });
  await rm(outDir, { recursive: true, force: true });
  await Promise.all([...pages].map(([file, text]) => writePage(join(outDir, file), text)));
  process.stdout.write(`Wrote ${pages.size} pages to ${DOCS_DIR}\n`);
}

async function writePage(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, "utf8");
}

await generate();
