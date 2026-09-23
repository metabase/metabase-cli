import { chromium } from "playwright";
import { z } from "zod";

import { OAUTH_SCOPE } from "@metabase/client/http/oauth";
import { JSON_CONTENT_TYPE } from "@metabase/client/json";

import type { E2EBootstrap } from "../../../tests/e2e/bootstrap-data";
import { DriverFailure } from "./app";

const SESSION_COOKIE = "metabase.SESSION";
const CONSENT_TIMEOUT_MS = 30_000;

const SessionResponse = z.object({ id: z.string() });

export interface ConsentAnswer {
  readonly status: number;
  readonly body: string;
}

async function adminSession(bootstrap: E2EBootstrap): Promise<string> {
  const response = await fetch(`${bootstrap.baseUrl}/api/session`, {
    method: "POST",
    headers: { "content-type": JSON_CONTENT_TYPE },
    body: JSON.stringify({
      username: bootstrap.admin.email,
      password: bootstrap.admin.password,
    }),
  });
  if (!response.ok) {
    throw new DriverFailure(
      `the admin could not sign in: ${response.status} ${await response.text()}`,
    );
  }
  return SessionResponse.parse(await response.json()).id;
}

function redirectUriOf(authorizeUrl: string): string {
  const query = authorizeUrl.slice(authorizeUrl.indexOf("?") + 1);
  const redirectUri = new URLSearchParams(query).get("redirect_uri");
  if (redirectUri === null) {
    throw new DriverFailure(`the authorize URL names no redirect_uri: ${authorizeUrl}`);
  }
  return redirectUri;
}

// Metabase's consent page starts with the full-access scope unticked.
export async function approveConsent(
  bootstrap: E2EBootstrap,
  authorizeUrl: string,
): Promise<ConsentAnswer> {
  const redirectUri = redirectUriOf(authorizeUrl);
  const sessionId = await adminSession(bootstrap);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.addCookies([{ name: SESSION_COOKIE, value: sessionId, url: bootstrap.baseUrl }]);
    const page = await context.newPage();
    page.setDefaultTimeout(CONSENT_TIMEOUT_MS);
    await page.goto(authorizeUrl);
    const form = page.locator("form#consent-form");
    await form.locator(`input[name="granted_scope"][value="${OAUTH_SCOPE}"]`).check();
    const callback = page.waitForResponse((response) => response.url().startsWith(redirectUri));
    await form.getByRole("button", { name: "Authorize", exact: true }).click();
    const answered = await callback;
    await page.waitForURL((url) => url.href.startsWith(redirectUri));
    return { status: answered.status(), body: await answered.text() };
  } finally {
    await browser.close();
  }
}
