import { createClient, type Client } from "../../../src/core/http/client";
import { readBootstrap } from "../bootstrap-data";
import { resolveSnapshotName } from "../defaults";

let cachedClient: Client | null = null;

async function adminClient(): Promise<Client> {
  if (cachedClient !== null) {
    return cachedClient;
  }
  const bootstrap = await readBootstrap();
  cachedClient = createClient({ url: bootstrap.baseUrl, apiKey: bootstrap.adminApiKey });
  return cachedClient;
}

export async function resetToCliDefault(): Promise<void> {
  const client = await adminClient();
  await client.requestRaw(`/api/testing/restore/${resolveSnapshotName()}`, {
    method: "POST",
    idempotent: true,
  });
}
