import { z } from "zod";

import {
  DEFAULT_PROFILE,
  keyringFallbackWarning,
  writeProbeFailure,
  writeProbeResult,
  writeProfile,
} from "../../core/auth/storage";
import { verifyAndProbe, type VerifyFailure } from "../../core/auth/verify";
import { explicitProfileName, readEnvCredentials } from "../../core/config";
import { ConfigError, errorMessage } from "../../core/errors";
import { normalizeUrl } from "../../core/url";
import { ParsedVersionSchema } from "../../core/version/tag";
import { Edition } from "../../runtime/capabilities";
import { ProbedUser } from "../../core/auth/profile-record";
import type { ResourceView } from "../../domain/view";
import { warn } from "../../output/notice";
import { promptPassword, promptText } from "../../output/prompt";
import { renderItem } from "../../output/render";
import { readInput } from "../../runtime/input";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { renderEditionLabel, renderUserName, renderUserRole, renderVersionTag } from "./render";

export const LoginResult = z.object({
  profile: z.string(),
  url: z.string(),
  authenticated: z.boolean(),
  user: ProbedUser.nullable(),
  version: ParsedVersionSchema.nullable(),
  edition: Edition.nullable(),
});
export type LoginResultJson = z.infer<typeof LoginResult>;

const loginView: ResourceView<LoginResultJson> = {
  compactPick: LoginResult,
  tableColumns: [
    { key: "profile", label: "Profile" },
    { key: "url", label: "Metabase URL" },
    {
      key: "authenticated",
      label: "Authenticated",
      format: (value) => (value === true ? "credentials verified" : "saved without verification"),
    },
    { key: "user", label: "Logged in as", format: (value) => renderUserName(value) },
    { key: "user", label: "Role", format: (value) => renderUserRole(value) },
    { key: "version", label: "Version", format: (value) => renderVersionTag(value) },
    { key: "edition", label: "Edition", format: (value) => renderEditionLabel(value) },
  ],
};

export default defineMetabaseCommand({
  meta: { name: "login", description: "Set Metabase credentials for a profile" },
  capabilities: { minVersion: 58, edition: "oss" },
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
    "mb auth login --url https://metabase.example.com < key.txt",
    "echo $METABASE_API_KEY | mb auth login --url https://metabase.example.com",
    "mb auth login --profile staging --url https://staging.example.com",
  ],
  async run({ args, ctx }) {
    const profileName = await resolveLoginProfile(args.profile);
    const env = readEnvCredentials();

    if (args.apiKey) {
      warn(
        "warning: --api-key is visible in shell history and process listings — pipe the key on stdin or set METABASE_API_KEY instead",
      );
    }

    const url = await resolveUrl(args.url, env.url);
    const apiKey = await resolveApiKey(args.apiKey, env.apiKey);

    if (args["skip-verify"]) {
      const location = await writeProfile({ url, apiKey }, profileName);
      if (location.backend === "file") {
        warn(keyringFallbackWarning(location, "credentials"));
      }
      renderItem(
        {
          profile: profileName,
          url,
          authenticated: false,
          user: null,
          version: null,
          edition: null,
        },
        loginView,
        ctx,
      );
      return;
    }

    const result = await verifyAndProbe(url, apiKey);
    if (!result.ok) {
      await writeProbeFailure(profileName, { kind: result.kind, reason: result.message });
      throw new ConfigError(formatVerifyFailureMessage(profileName, result));
    }

    const location = await writeProfile({ url, apiKey }, profileName);
    if (location.backend === "file") {
      warn(keyringFallbackWarning(location, "credentials"));
    }
    await writeProbeResult(profileName, { user: result.user, server: result.server });

    renderItem(
      {
        profile: profileName,
        url,
        authenticated: true,
        user: result.user,
        version: result.server.version,
        edition: result.server.edition,
      },
      loginView,
      ctx,
    );
  },
});

function formatVerifyFailureMessage(profileName: string, failure: VerifyFailure): string {
  const which = failure.which === "user" ? "/api/user/current" : "/api/session/properties";
  return `verification failed (${which}): ${failure.message} — credentials were not saved for profile "${profileName}"`;
}

async function resolveLoginProfile(flagProfile: string | undefined): Promise<string> {
  const explicit = explicitProfileName(flagProfile);
  if (explicit !== null) {
    return explicit;
  }
  if (!process.stdin.isTTY) {
    return DEFAULT_PROFILE;
  }
  const entered = (
    await promptText({
      message: "Profile name",
      placeholder: DEFAULT_PROFILE,
    })
  ).trim();
  return entered === "" ? DEFAULT_PROFILE : entered;
}

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
