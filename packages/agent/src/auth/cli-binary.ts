import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { errorMessage } from "@metabase/cli/errors";
import { z } from "zod";

const CLI_PACKAGE = "@metabase/cli";

const resolveFrom = createRequire(import.meta.url);

const CliManifest = z.object({ bin: z.object({ mb: z.string() }) });

export class CliBinaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliBinaryError";
  }
}

// The login flow `mb-agent auth` spawns is the CLI's, so it needs the CLI's entry script. Resolving
// it through this package's dependency graph — never `PATH` — is what makes it the CLI this agent
// depends on: a globally installed `mb` would answer as whoever logged that install in, against a
// profile store this product does not own. Nothing the model can reach goes through here.
export async function resolveCliScript(): Promise<string> {
  let manifestPath: string;
  try {
    manifestPath = resolveFrom.resolve(`${CLI_PACKAGE}/package.json`);
  } catch (error) {
    throw new CliBinaryError(
      `Cannot locate the ${CLI_PACKAGE} package this agent depends on: ${errorMessage(error)}. Reinstall mb-agent.`,
    );
  }
  const manifest = CliManifest.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  return join(dirname(manifestPath), manifest.bin.mb);
}
