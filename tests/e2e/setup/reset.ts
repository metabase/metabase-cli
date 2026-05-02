import { createClient, type Client } from "../../../src/core/http/client";
import { readBootstrap } from "../bootstrap-data";
import { E2E_SNAPSHOT_NAME } from "../seed/ids";

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
  await client.requestRaw(`/api/testing/restore/${E2E_SNAPSHOT_NAME}`, {
    method: "POST",
    idempotent: true,
  });
}
