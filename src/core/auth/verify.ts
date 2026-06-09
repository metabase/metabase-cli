import { CurrentUser } from "../../domain/user";
import { errorMessage, MetabaseError, NetworkError, TimeoutError } from "../errors";
import { createClient } from "../http/client";
import { HttpError } from "../http/errors";
import { probeServer, PROBE_TIMEOUT_MS, type ServerInfo } from "../version/probe";

import type { Credential, CredentialRefresher } from "./credential";
import { type ProbedUser, type ProfileFailureKind } from "./profile-record";

const VERIFY_TIMEOUT_MS = 15_000;
const USER_PATH = "/api/user/current";

export type VerifyWhich = "user" | "server";

export interface VerifySuccess {
  ok: true;
  user: ProbedUser;
  server: ServerInfo;
}

export interface VerifyFailure {
  ok: false;
  which: VerifyWhich;
  kind: ProfileFailureKind;
  status?: number;
  message: string;
}

export type Verification = VerifySuccess | VerifyFailure;

export async function verifyAndProbe(
  url: string,
  credential: Credential,
  refresh?: CredentialRefresher,
): Promise<Verification> {
  const client = createClient(
    { url, credential },
    refresh === undefined ? {} : { refreshCredential: refresh },
  );
  const userPromise = client.requestParsed(CurrentUser, USER_PATH, {
    timeoutMs: VERIFY_TIMEOUT_MS,
    retries: 0,
  });
  const serverPromise = probeServer(client);
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
    return { ok: false, which, kind, status: error.status, message: error.userMessage };
  }
  if (error instanceof NetworkError || error instanceof TimeoutError) {
    return { ok: false, which, kind: "network", message: error.userMessage };
  }
  if (error instanceof MetabaseError) {
    return { ok: false, which, kind: "server", message: error.userMessage };
  }
  return { ok: false, which, kind: "server", message: errorMessage(error) };
}

export { PROBE_TIMEOUT_MS, VERIFY_TIMEOUT_MS };
