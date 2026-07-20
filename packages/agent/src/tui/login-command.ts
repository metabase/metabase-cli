import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  oauthLogin,
  openBrowser,
  tryDiscoverMetadata,
  verifyAndProbe,
  writeOAuthProfile,
  writeProbeResult,
} from "@metabase/cli/auth";
import { errorMessage } from "@metabase/cli/errors";
import { normalizeUrl } from "@metabase/cli/url";
import { useAgentProfileStore } from "../auth/store";
import type { MetabaseAccess } from "../metabase/access";
import { createMetabaseConnection } from "../metabase/connection";
import { probeInstance } from "../metabase/probe";

const COMMAND = "mb-login";
const NO_URL = "Which instance? Run `/mb-login <url>` — e.g. `/mb-login http://localhost:3000`.";
const NO_OAUTH =
  "This Metabase does not offer browser login (it needs v63+). Quit and run `mb-agent auth login --url <url>` to sign in with an API key instead.";

export interface LoginCommandOptions {
  access: MetabaseAccess;
  profile: string;
}

// Signing in cannot be pi's `/login` — that one authenticates a model provider, and its store is
// keyed by provider. This one runs the CLI's own browser (OAuth) flow, which needs no terminal of
// its own: it opens a browser and waits on a loopback callback, so it works while pi owns the screen.
export function metabaseLoginExtension(options: LoginCommandOptions) {
  return (pi: ExtensionAPI): void => {
    pi.registerCommand(COMMAND, {
      description: "Sign in to a Metabase instance through the browser: /mb-login <url>",
      handler: (args, ctx) => login(args.trim(), options, ctx),
    });
  };
}

async function login(
  argument: string,
  options: LoginCommandOptions,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const target = argument === "" ? options.access.url() : argument;
  if (target === null) {
    ctx.ui.notify(NO_URL, "error");
    return;
  }
  useAgentProfileStore();

  let url: string;
  try {
    url = normalizeUrl(target);
  } catch (error) {
    ctx.ui.notify(`"${target}" is not a usable Metabase URL: ${errorMessage(error)}`, "error");
    return;
  }

  try {
    await authenticate(url, options, ctx);
  } catch (error) {
    ctx.ui.notify(`Login failed: ${errorMessage(error)}`, "error");
  }
}

async function authenticate(
  url: string,
  options: LoginCommandOptions,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const metadata = await tryDiscoverMetadata(url);
  if (metadata === null) {
    ctx.ui.notify(NO_OAUTH, "error");
    return;
  }

  ctx.ui.notify(`Opening ${url} in your browser — sign in and approve to continue.`, "info");
  const credential = await oauthLogin(
    { baseUrl: url, metadata },
    {
      openBrowser,
      onAuthorizeUrl: (authorizeUrl, opened) => {
        if (!opened) {
          ctx.ui.notify(`Open this URL to approve: ${authorizeUrl}`, "warning");
        }
      },
      now: () => Date.now(),
    },
  );

  const verification = await verifyAndProbe(url, credential);
  if (!verification.ok) {
    ctx.ui.notify(
      `Signed in, but ${url} rejected the credential: ${verification.message}`,
      "error",
    );
    return;
  }

  await writeOAuthProfile(url, credential, options.profile);
  await writeProbeResult(options.profile, { user: verification.user, server: verification.server });

  const connection = await createMetabaseConnection({ profile: options.profile });
  options.access.adopt(connection, await probeInstance(connection.client, connection.url));
  ctx.ui.notify(`Signed in to ${connection.url} as ${verification.user.name}.`, "info");
  // The instance facts — version, edition, token features, who the agent is — are built into the
  // system prompt, and this session was built before there was an instance to describe. A fresh
  // session runs back through the same factory, which now reads a connected one.
  await ctx.newSession();
}
