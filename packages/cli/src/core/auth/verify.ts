import type { Credential, CredentialRefresher } from "@metabase/client/auth/credential";
import { createClient } from "@metabase/client/client";
import { errorMessage, MetabaseError, NetworkError, TimeoutError } from "@metabase/client/errors";
import { HttpError } from "@metabase/client/http/errors";
import { probeServer, type ServerInfo } from "@metabase/client/version/probe";

import { USER_AGENT } from "../user-agent";
import { type ProbedUser, type ProfileFailureKind } from "./profile-record";

const VERIFY_TIMEOUT_MS = 15_000;

export type VerifyWhich = "user" | "server";

interface VerifySuccess {
  ok: true;
  user: ProbedUser;
  server: ServerInfo;
}

export interface VerifyFailure {
  ok: false;
  which: VerifyWhich;
  kind: ProfileFailureKind;
  status?: number;
  // The request that failed. A proxy or gateway in front of Metabase typically blocks one route
  // rather than the host, and neither a server's own message nor a transport failure names it.
  // Absent only for a failure raised before a request was made.
  endpoint?: string;
  message: string;
}

export type Verification = VerifySuccess | VerifyFailure;

interface VerifyOptions {
  refresh?: CredentialRefresher;
  signal?: AbortSignal;
}

export async function verifyAndProbe(
  url: string,
  credential: Credential,
  options: VerifyOptions = {},
): Promise<Verification> {
  const { refresh, signal } = options;
  const mb = createClient(
    { url, credential },
    {
      userAgent: USER_AGENT,
      ...(refresh !== undefined && { refreshCredential: refresh }),
      ...(signal !== undefined && { signal }),
    },
  );
  // Concurrent by design: two simultaneous 401s share the transport's single-flight token refresh,
  // and serialising them would leave that path unexercised.
  const userPromise = mb.user.current({ timeoutMs: VERIFY_TIMEOUT_MS, retries: 0 });
  const serverPromise = probeServer(mb);
  const [userResult, serverResult] = await Promise.allSettled([userPromise, serverPromise]);

  if (userResult.status === "rejected") {
    return failure(userResult.reason, "user");
  }
  if (serverResult.status === "rejected") {
    return failure(serverResult.reason, "server");
  }

  const probed: ProbedUser = {
    id: userResult.value.id,
    name: userResult.value.common_name,
    isAdmin: userResult.value.is_superuser,
  };
  return { ok: true, user: probed, server: serverResult.value };
}

function failure(error: unknown, which: VerifyWhich): VerifyFailure {
  if (error instanceof HttpError) {
    const kind = error.status === 401 || error.status === 403 ? "auth" : "server";
    return {
      ok: false,
      which,
      kind,
      status: error.status,
      endpoint: error.developerDetail.url,
      message: error.userMessage,
    };
  }
  if (error instanceof NetworkError) {
    return {
      ok: false,
      which,
      kind: "network",
      endpoint: error.developerDetail.url,
      message: error.userMessage,
    };
  }
  if (error instanceof TimeoutError) {
    const detail = error.developerDetail;
    return {
      ok: false,
      which,
      kind: "network",
      ...(detail.kind === "http" && { endpoint: detail.url }),
      message: error.userMessage,
    };
  }
  if (error instanceof MetabaseError) {
    return { ok: false, which, kind: "server", message: error.userMessage };
  }
  return { ok: false, which, kind: "server", message: errorMessage(error) };
}
