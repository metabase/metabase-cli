import { z } from "zod";

import { writeProfile } from "../../core/auth/storage";
import { verifyCredentials } from "../../core/auth/verify";
import { readEnvCredentials, resolveProfileName } from "../../core/config";
import { ConfigError, errorMessage } from "../../core/errors";
import { normalizeUrl } from "../../core/url";
import type { ResourceView } from "../../domain/view";
import { warn } from "../../output/notice";
import { promptPassword, promptText } from "../../output/prompt";
import { renderItem } from "../../output/render";
import { readInput } from "../../runtime/input";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export const LoginResult = z.object({
  profile: z.string(),
  url: z.string(),
  authenticated: z.boolean(),
  email: z.string().nullable(),
});
export type LoginResultJson = z.infer<typeof LoginResult>;

const loginView: ResourceView<LoginResultJson> = {
  compactPick: LoginResult,
  tableColumns: [
    { key: "profile", label: "Profile" },
    { key: "url", label: "URL" },
    { key: "authenticated", label: "Authenticated" },
    { key: "email", label: "Email" },
  ],
};

export default defineMetabaseCommand({
  meta: { name: "login", description: "Set Metabase credentials for a profile" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    "skip-verify": {
      type: "boolean",
      default: false,
      description: "Save without contacting the server",
    },
  },
  outputSchema: LoginResult,
  examples: [
    "metabase auth login --url https://metabase.example.com < key.txt",
    "echo $METABASE_API_KEY | metabase auth login --url https://metabase.example.com",
    "metabase auth login --profile staging --url https://staging.example.com",
  ],
  async run({ args, ctx }) {
    const profileName = resolveProfileName(args.profile);
    const env = readEnvCredentials();

    if (args.apiKey) {
      warn(
        "warning: --api-key is visible in shell history and process listings — pipe the key on stdin or set METABASE_API_KEY instead",
      );
    }

    const url = await resolveUrl(args.url, env.url);
    const apiKey = await resolveApiKey(args.apiKey, env.apiKey);

    let email: string | null = null;
    let authenticated = false;
    if (!args["skip-verify"]) {
      const result = await verifyCredentials(url, apiKey);
      if (!result.ok) {
        throw new ConfigError(`verification failed: ${result.message}`);
      }
      email = result.user.email;
      authenticated = true;
    }

    const location = await writeProfile({ url, apiKey }, profileName);
    if (location.backend === "file") {
      warn(`warning: OS keychain unavailable; credentials stored as plaintext at ${location.path}`);
    }

    renderItem({ profile: profileName, url, authenticated, email }, loginView, ctx);
  },
});

async function resolveUrl(flagUrl: string | undefined, envUrl: string | null): Promise<string> {
  if (flagUrl) {
    return normalizeUrl(flagUrl);
  }
  if (envUrl) {
    return normalizeUrl(envUrl);
  }
  return promptForUrl();
}

async function resolveApiKey(flagKey: string | undefined, envKey: string | null): Promise<string> {
  if (flagKey) {
    return flagKey;
  }
  const piped = (await readInput({ required: false })).trim();
  if (piped) {
    return piped;
  }
  if (envKey) {
    return envKey;
  }
  return promptForApiKey();
}

async function promptForUrl(): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new ConfigError(
      "--url is required when stdin is not a TTY (cannot prompt interactively)",
    );
  }
  const value = await promptText({
    message: "Metabase URL",
    placeholder: "https://metabase.example.com",
    validate(input) {
      if (!input) {
        return "URL is required";
      }
      try {
        normalizeUrl(input);
      } catch (error) {
        return errorMessage(error);
      }
      return undefined;
    },
  });
  return normalizeUrl(value);
}

async function promptForApiKey(): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new ConfigError(
      "--api-key, piped stdin, or METABASE_API_KEY required when stdin is not a TTY",
    );
  }
  return promptPassword({
    message: "API key",
    mask: "•",
    validate: (input) => (input ? undefined : "API key is required"),
  });
}
