import { createHash, randomBytes } from "node:crypto";

export interface Pkce {
  verifier: string;
  challenge: string;
}

// RFC 7636: a 32-byte random value base64url-encodes to 43 chars, within the 43–128 range.
const VERIFIER_BYTES = 32;
const STATE_BYTES = 16;

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

export function generatePkce(): Pkce {
  const verifier = base64Url(randomBytes(VERIFIER_BYTES));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function randomState(): string {
  return base64Url(randomBytes(STATE_BYTES));
}
