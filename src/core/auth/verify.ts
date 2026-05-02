import { CurrentUser } from "../../domain/user";
import { errorMessage, MetabaseError } from "../errors";
import { createClient } from "../http/client";
import { HttpError } from "../http/errors";

const VERIFY_TIMEOUT_MS = 15_000;

export interface VerifySuccess {
  ok: true;
  user: CurrentUser;
}

export interface VerifyFailure {
  ok: false;
  status?: number;
  message: string;
}

export type Verification = VerifySuccess | VerifyFailure;

export async function verifyCredentials(url: string, apiKey: string): Promise<Verification> {
  const client = createClient({ url, apiKey });
  try {
    const user = await client.requestParsed(CurrentUser, "/api/user/current", {
      timeoutMs: VERIFY_TIMEOUT_MS,
      retries: 0,
    });
    return { ok: true, user };
  } catch (error) {
    return failure(error);
  }
}

function failure(error: unknown): VerifyFailure {
  if (error instanceof HttpError) {
    return { ok: false, status: error.status, message: error.userMessage };
  }
  if (error instanceof MetabaseError) {
    return { ok: false, message: error.userMessage };
  }
  return { ok: false, message: errorMessage(error) };
}
