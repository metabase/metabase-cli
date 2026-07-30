import { createTransport, type Transport } from "@metabase/client/http/transport";

import { USER_AGENT } from "../../../packages/cli/src/core/user-agent";
import { readBootstrap } from "../bootstrap-data";
import { resolveSnapshotName } from "../defaults";

let cachedClient: Transport | null = null;

async function adminClient(): Promise<Transport> {
  if (cachedClient !== null) {
    return cachedClient;
  }
  const bootstrap = await readBootstrap();
  cachedClient = createTransport(
    { url: bootstrap.baseUrl, credential: { kind: "apiKey", apiKey: bootstrap.adminApiKey } },
    { userAgent: USER_AGENT },
  );
  return cachedClient;
}

export async function resetToCliDefault(): Promise<void> {
  const client = await adminClient();
  await client.requestRaw(`/api/testing/restore/${resolveSnapshotName()}`, {
    method: "POST",
    idempotent: true,
  });
}
