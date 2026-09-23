import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { errorMessage } from "@metabase/client/errors";
import { discoverOAuth } from "@metabase/client/http/oauth";
import { normalizeUrl } from "@metabase/client/url";

import { USER_AGENT, connect, probeAuthMethod } from "../src/main/auth/oauth";
import { readBootstrap, type E2EBootstrap } from "../../../tests/e2e/bootstrap-data";
import { approveConsent } from "./consent";

const EVIDENCE_DIR_ENV_VAR = "RDE_EVIDENCE_DIR";

const NO_OAUTH_EXIT = 1;

class OAuthCheckFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthCheckFailure";
  }
}

function evidenceDir(env: NodeJS.ProcessEnv): string {
  const dir = env[EVIDENCE_DIR_ENV_VAR];
  if (dir === undefined) {
    throw new OAuthCheckFailure(`${EVIDENCE_DIR_ENV_VAR} is not set; it names where the log goes`);
  }
  return dir;
}

function timestamp(): string {
  return new Date().toISOString().replaceAll(":", "-");
}

function consentBrowser(
  bootstrap: E2EBootstrap,
  transcript: string[],
): (url: string) => Promise<boolean> {
  return async (url: string): Promise<boolean> => {
    const answer = await approveConsent(bootstrap, url);
    transcript.push(`the callback answered ${answer.status}: ${answer.body}`);
    return true;
  };
}

async function main(): Promise<void> {
  const dir = evidenceDir(process.env);
  await mkdir(dir, { recursive: true });
  const transcript: string[] = [];
  const bootstrap = await readBootstrap();
  transcript.push(`metabase ${bootstrap.baseUrl}`);

  const discovery = await discoverOAuth(normalizeUrl(bootstrap.baseUrl), USER_AGENT);
  transcript.push(`discovery: ${JSON.stringify(discovery)}`);
  const interrupt = new AbortController();
  const method = await probeAuthMethod(bootstrap.baseUrl, interrupt.signal);
  transcript.push(`probe: ${JSON.stringify(method)}`);
  await writeFile(
    join(dir, `${timestamp()}_oauth-check.log`),
    `${transcript.join("\n")}\n`,
    "utf8",
  );

  if (method.kind !== "oauth") {
    throw new OAuthCheckFailure(
      `${bootstrap.baseUrl} offers no OAuth this app can use, so the grant cannot be driven here: ${JSON.stringify(method)}`,
    );
  }

  const result = await connect(
    { url: bootstrap.baseUrl, apiKey: null },
    {
      openBrowser: consentBrowser(bootstrap, transcript),
      onAuthorizeUrl: (url, opened) => transcript.push(`authorize url (opened=${opened}): ${url}`),
      now: Date.now,
    },
    interrupt.signal,
  );
  transcript.push(`connect: ${result.kind}`);
  await writeFile(
    join(dir, `${timestamp()}_oauth-check.log`),
    `${transcript.join("\n")}\n`,
    "utf8",
  );

  if (result.kind === "failed") {
    throw new OAuthCheckFailure(`the OAuth grant failed: ${result.message}`);
  }
  process.stdout.write(
    `oauth-check ok: ${result.connected.url} as ${result.connected.user.email} (${result.credential.kind})\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`oauth-check failed: ${errorMessage(error)}\n`);
  process.exitCode = NO_OAUTH_EXIT;
});
