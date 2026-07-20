import { z } from "zod";

import type { Credential } from "../../core/auth/credential";
import { oauthLogin } from "../../core/auth/oauth-login";
import { revokeOAuthCredential } from "../../core/auth/oauth-session";
import {
  consumeKeychainResidualWarning,
  consumeKeyringDowngradeWarning,
  type CredentialLocation,
  DEFAULT_PROFILE,
  keyringFallbackWarning,
  writeOAuthProfile,
  writeProbeFailure,
  writeProbeResult,
  writeProfile,
} from "../../core/auth/storage";
import { verifyAndProbe, type VerifyFailure } from "../../core/auth/verify";
import { explicitProfileName, readEnvCredentials } from "../../core/config";
import { ConfigError, errorMessage } from "../../core/errors";
import { normalizeUrl } from "../../core/url";
import { ParsedVersionSchema } from "../../core/version/tag";
import { ProbedUser } from "../../core/auth/profile-record";
import type { ResourceView } from "../../domain/view";
import { tryDiscoverMetadata, type OAuthServerMetadata } from "../../core/http/oauth";
import { warn } from "../../output/notice";
import { promptPassword, promptSelect, promptText } from "../../output/prompt";
import { renderSummary } from "../../output/render";
import { openBrowser } from "../../runtime/process";
import { readInput } from "../../runtime/input";
import type { CommonContext } from "../context";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { EMPTY_CELL, renderUserName, renderUserRole, renderVersionTag } from "./render";

export const LoginResult = z.object({
  profile: z.string(),
  url: z.string(),
  authenticated: z.boolean(),
  user: ProbedUser.nullable(),
  version: ParsedVersionSchema.nullable(),
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
  ],
};

export default defineMetabaseCommand({
  meta: { name: "login", description: "Log in to a Metabase instance for a profile" },
  details:
    "Interactive login offers browser OAuth (recommended; Metabase v63+) or an API key — older servers fall back to the API key prompt automatically. Browser login opens Metabase, you sign in (password or SSO) and approve, and the CLI stores a refreshing access token. For CI/non-interactive use, supply an API key via --api-key, piped stdin, or $MB_API_KEY (first non-empty wins); any of these skips the browser flow, even on a TTY. The URL comes from --url or $MB_URL, prompted when stdin is a TTY.",
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    clientId: {
      type: "string",
      description: "Pre-registered OAuth client id (when dynamic registration is disabled)",
      alias: "client-id",
    },
    "skip-verify": {
      type: "boolean",
      default: false,
      description: "Save without contacting the server",
    },
  },
  outputSchema: LoginResult,
  examples: [
    "mb auth login --url https://metabase.example.com",
    "echo $MB_API_KEY | mb auth login --url https://metabase.example.com",
    "mb auth login --profile staging --url https://staging.example.com",
  ],
  async run({ args, ctx }) {
    const profileName = await resolveLoginProfile(args.profile);
    const env = readEnvCredentials();

    if (args.apiKey) {
      warn(
        "warning: --api-key is visible in shell history and process listings — pipe the key on stdin or set MB_API_KEY instead",
      );
    }

    const url = await resolveUrl(args.url, env.url);
    const apiKey = await nonInteractiveApiKey(args.apiKey, env.apiKey);

    if (apiKey !== null) {
      await completeLogin(
        profileName,
        url,
        { kind: "apiKey", apiKey },
        args["skip-verify"],
        ctx,
        () => writeProfile({ url, apiKey }, profileName),
      );
      return;
    }

    if (!process.stdin.isTTY) {
      throw new ConfigError(
        "interactive login requires a TTY; pass --api-key or set MB_API_KEY for non-interactive login",
      );
    }

    const metadata = await probeOAuthSupport(url);
    const method = await chooseLoginMethod(metadata, args.clientId);

    if (method === "apiKey") {
      const promptedKey = await promptForApiKey();
      await completeLogin(
        profileName,
        url,
        { kind: "apiKey", apiKey: promptedKey },
        args["skip-verify"],
        ctx,
        () => writeProfile({ url, apiKey: promptedKey }, profileName),
      );
      return;
    }

    const credential = await oauthLogin(
      {
        baseUrl: url,
        ...(metadata !== null && { metadata }),
        ...(args.clientId !== undefined && { clientId: args.clientId }),
      },
      { openBrowser, onAuthorizeUrl: announceAuthorizeUrl, now: () => Date.now() },
    );
    await completeLogin(profileName, url, credential, args["skip-verify"], ctx, () =>
      writeOAuthProfile(url, credential, profileName),
    );
  },
});

type LoginMethod = "oauth" | "apiKey";

// Reaching the server but finding no CLI-capable OAuth server (pre-v63) degrades to the API key
// prompt; not reaching it at all is an error worth stopping on before any credential is collected.
async function probeOAuthSupport(url: string): Promise<OAuthServerMetadata | null> {
  try {
    return await tryDiscoverMetadata(url);
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }
    throw new ConfigError(`could not reach ${url}: ${errorMessage(error)}`);
  }
}

async function chooseLoginMethod(
  metadata: OAuthServerMetadata | null,
  clientId: string | undefined,
): Promise<LoginMethod> {
  if (metadata === null) {
    if (clientId !== undefined) {
      throw new ConfigError(
        "--client-id was given but this Metabase does not support OAuth login (requires Metabase v63 or newer)",
      );
    }
    warn(
      "This Metabase does not support browser login (requires Metabase v63 or newer); using an API key instead.",
    );
    return "apiKey";
  }
  if (clientId !== undefined) {
    return "oauth";
  }
  return promptSelect<LoginMethod>({
    message: "How do you want to log in?",
    choices: [
      {
        value: "oauth",
        label: "In your browser (recommended)",
        hint: "sign in to Metabase with password or SSO and approve the CLI",
      },
      {
        value: "apiKey",
        label: "With an API key",
        hint: "paste a key from Admin settings → Authentication → API keys",
      },
    ],
    initialValue: "oauth",
  });
}

async function promptForApiKey(): Promise<string> {
  return promptPassword({
    message: "API key",
    mask: "•",
    validate: (input) => (input ? undefined : "API key is required"),
  });
}

type PersistCredential = () => Promise<CredentialLocation>;

async function completeLogin(
  profileName: string,
  url: string,
  credential: Credential,
  skipVerify: boolean,
  ctx: CommonContext,
  persist: PersistCredential,
): Promise<void> {
  if (skipVerify) {
    await persistWithWarning(persist);
    renderSummary(
      { profile: profileName, url, authenticated: false, user: null, version: null },
      loginView,
      `Saved credentials for profile "${profileName}" (${url}) without verifying.`,
      ctx,
    );
    return;
  }

  const result = await verifyAndProbe(url, credential);
  if (!result.ok) {
    await writeProbeFailure(profileName, { kind: result.kind, reason: result.message });
    await revokeUnsavedOAuthCredential(url, credential);
    throw new ConfigError(formatVerifyFailureMessage(profileName, result));
  }

  await persistWithWarning(persist);
  await writeProbeResult(profileName, { user: result.user, server: result.server });

  const who = renderUserName(result.user);
  const role = renderUserRole(result.user);
  const versionTag = renderVersionTag(result.server.version);
  const serverClause = versionTag === EMPTY_CELL ? "" : ` Server ${versionTag}.`;
  renderSummary(
    {
      profile: profileName,
      url,
      authenticated: true,
      user: result.user,
      version: result.server.version,
    },
    loginView,
    `Logged in to ${url} as ${who} (${role}). Saved to profile "${profileName}".${serverClause}`,
    ctx,
  );
}

// The browser consent already minted live tokens; failing verify means they will never be saved,
// so release the grant server-side rather than leaving it registered with no holder. Best-effort,
// mirroring logout — the verify failure is what the user needs to see.
async function revokeUnsavedOAuthCredential(url: string, credential: Credential): Promise<void> {
  if (credential.kind !== "oauth") {
    return;
  }
  try {
    const revoked = await revokeOAuthCredential(url, credential);
    if (!revoked) {
      warn(
        "server does not advertise a revocation endpoint; the unsaved tokens remain valid until they expire",
      );
    }
  } catch (error) {
    warn(`could not revoke the unsaved tokens server-side: ${errorMessage(error)}`);
  }
}

async function persistWithWarning(persist: PersistCredential): Promise<void> {
  const location = await persist();
  if (location.backend === "file") {
    warn(keyringFallbackWarning(location));
  }
  const residual = consumeKeychainResidualWarning();
  if (residual !== null) {
    warn(residual);
  }
  // The location warning above already covers an at-login plaintext fallback; discard the pending
  // downgrade notice so the command shell doesn't print the same thing a second time.
  consumeKeyringDowngradeWarning();
}

function announceAuthorizeUrl(url: string, opened: boolean): void {
  if (opened) {
    warn(`Opening your browser to finish login. If it didn't open, visit:\n  ${url}`);
    return;
  }
  warn(`Open this URL in your browser to finish login:\n  ${url}`);
}

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
      defaultValue: DEFAULT_PROFILE,
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

async function nonInteractiveApiKey(
  flagKey: string | undefined,
  envKey: string | null,
): Promise<string | null> {
  if (flagKey) {
    return flagKey;
  }
  if (!process.stdin.isTTY) {
    const piped = (await readInput({ required: false })).trim();
    if (piped) {
      return piped;
    }
  }
  if (envKey) {
    if (process.stdin.isTTY) {
      warn("using the API key from $MB_API_KEY; unset it to choose browser login");
    }
    return envKey;
  }
  return null;
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
