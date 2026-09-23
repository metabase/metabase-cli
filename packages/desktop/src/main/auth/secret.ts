import { safeStorage } from "electron";

import { parseJson } from "@metabase/client/json";

import { StoredCredential } from "../../contracts/settings";

const BLOB_ENCODING = "base64";

const ENCRYPTION_UNAVAILABLE_MESSAGE =
  "This desktop session offers no secret storage, so the Metabase credential cannot be encrypted. " +
  "Install gnome-keyring or kwallet, or launch RDE with --password-store=basic.";

class SecretStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretStorageError";
  }
}

function requireEncryption(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new SecretStorageError(ENCRYPTION_UNAVAILABLE_MESSAGE);
  }
}

export interface CredentialCipher {
  encrypt(credential: StoredCredential): string;
  decrypt(blob: string): StoredCredential;
}

export const credentialCipher: CredentialCipher = {
  encrypt(credential) {
    requireEncryption();
    return safeStorage.encryptString(JSON.stringify(credential)).toString(BLOB_ENCODING);
  },
  decrypt(blob) {
    requireEncryption();
    const plain = safeStorage.decryptString(Buffer.from(blob, BLOB_ENCODING));
    return parseJson(plain, StoredCredential, { source: "the stored Metabase credential" });
  },
};
