import { z } from "zod";

import { writeLicense } from "../../core/auth/storage";
import { readEnvLicenseToken } from "../../core/config";
import { ConfigError } from "../../core/errors";
import type { ResourceView } from "../../domain/view";
import { warn } from "../../output/notice";
import { promptPassword } from "../../output/prompt";
import { renderItem } from "../../output/render";
import { readInput } from "../../runtime/input";
import { outputFlags } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export const LicenseSetResult = z.object({
  stored: z.literal(true),
});
export type LicenseSetResultJson = z.infer<typeof LicenseSetResult>;

const licenseSetView: ResourceView<LicenseSetResultJson> = {
  compactPick: LicenseSetResult,
  tableColumns: [{ key: "stored", label: "Stored" }],
};

export default defineMetabaseCommand({
  meta: { name: "set", description: "Store a Metabase license token" },
  args: {
    ...outputFlags,
    token: {
      type: "positional",
      description: "License token (visible in shell history; pipe on stdin instead)",
      required: false,
    },
  },
  outputSchema: LicenseSetResult,
  examples: [
    "echo $METABASE_LICENSE_TOKEN | metabase license set",
    "metabase license set < token.txt",
    "metabase license set $METABASE_LICENSE_TOKEN",
  ],
  async run({ args, ctx }) {
    const token = await resolveToken(args.token);
    const location = await writeLicense(token);

    if (location.backend === "file") {
      warn(`warning: OS keychain unavailable; license stored as plaintext at ${location.path}`);
    }

    const result: LicenseSetResultJson = { stored: true };
    renderItem(result, licenseSetView, ctx);
  },
});

async function resolveToken(positional: string | undefined): Promise<string> {
  if (positional) {
    warn(
      "warning: license token passed as positional is visible in shell history and process listings — pipe the token on stdin or set METABASE_LICENSE_TOKEN instead",
    );
    return positional;
  }
  const piped = (await readInput({ required: false })).trim();
  if (piped) {
    return piped;
  }
  const envToken = readEnvLicenseToken();
  if (envToken) {
    return envToken;
  }
  return promptForToken();
}

async function promptForToken(): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new ConfigError(
      "license token, piped stdin, or METABASE_LICENSE_TOKEN required when stdin is not a TTY",
    );
  }
  return promptPassword({
    message: "License token",
    mask: "•",
    validate: (input) => (input ? undefined : "License token is required"),
  });
}
