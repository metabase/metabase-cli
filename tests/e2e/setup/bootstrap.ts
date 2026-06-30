import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { errorMessage, isNotFoundError } from "../../../src/core/errors";
import { createClient, type Client } from "../../../src/core/http/client";
import { HttpError } from "../../../src/core/http/errors";
import { backoffDelay, DEFAULT_MAX_RETRIES, runWithRetries } from "../../../src/core/http/retry";
import { tryDiscoverMetadata } from "../../../src/core/http/oauth";
import { probeServer, type ServerInfo } from "../../../src/core/version/probe";
import { CardQueryResult } from "../../../src/domain/card";
import { CurrentUser } from "../../../src/domain/user";
import { parseJsonResult } from "../../../src/runtime/json";
import { pollUntil } from "../../../src/runtime/poll";
import {
  Bootstrap,
  BOOTSTRAP_FILE_PATH,
  type E2EBootstrap,
  type SeededIds,
} from "../bootstrap-data";
import { resolveE2EBaseUrl, resolveSnapshotName } from "../defaults";
import { E2E_GROUPS } from "../seed/ids";

const HERE = dirname(fileURLToPath(import.meta.url));
const E2E_ROOT = resolve(HERE, "..");
const SNAPSHOT_NAME = resolveSnapshotName();
const SNAPSHOT_FILE_PATH = resolve(E2E_ROOT, "snapshots", `${SNAPSHOT_NAME}.sql`);

const ADMIN = {
  first_name: "Admin",
  last_name: "E2E",
  email: "admin@e2e.test",
  password: "e2e-admin-password",
  site_name: "metabase-cli-e2e",
} as const;

const HEALTH_TIMEOUT_MS = 60_000;
const HEALTH_POLL_INTERVAL_MS = 1000;
const SYNC_TIMEOUT_MS = 90_000;
const SYNC_POLL_INTERVAL_MS = 1000;
const SYNC_MIN_TABLES = 5;

const WAREHOUSE_DB_NAME = "Warehouse";
const WAREHOUSE_CONNECTION = {
  host: "data-db",
  port: 5432,
  dbname: "warehouse",
  user: "metabase_test",
  password: "metabase_test",
  ssl: false,
} as const;
const DEFAULT_COLLECTION_NAME = "E2E Default";
const ORDERS_BY_STATUS_CARD_NAME = "Orders by status";
const ORDERS_BY_STATUS_SQL = "SELECT status, COUNT(*) AS n FROM orders GROUP BY status";
const ORDERS_OVERVIEW_DASHBOARD_NAME = "Orders Overview";
const ORDERS_OVERVIEW_DASHBOARD_DESCRIPTION = "E2E seeded dashboard with one orders dashcard.";
const LIMITED_GROUP_NAME = "E2E Limited";
const LIBRARY_FEATURE = "library";
const LIBRARY_MIN_VERSION = 59;

const BASE_URL = resolveE2EBaseUrl();

const SessionPropertiesResponse = z.object({ "setup-token": z.string().nullish() }).loose();
const SessionResponse = z.object({ id: z.string() });
const ApiKeyResponse = z.object({ unmasked_key: z.string() }).loose();
const EntityWithIdResponse = z.object({ id: z.number() }).loose();
const FieldMeta = z.object({ id: z.number().int(), name: z.string() }).loose();
const TableMeta = z
  .object({ id: z.number().int(), name: z.string(), fields: z.array(FieldMeta).optional() })
  .loose();
const DatabaseMetadataResponse = z.object({ tables: z.array(TableMeta) }).loose();
const PermissionsGroupResponse = z.object({ id: z.number().int().positive() }).loose();
const CollectionGraphResponse = z
  .object({ revision: z.number().int(), groups: z.record(z.string(), z.unknown()) })
  .loose();
const DashboardWithDashcardsResponse = z
  .object({
    id: z.number().int(),
    dashcards: z.array(z.object({ id: z.number().int() }).loose()),
  })
  .loose();

async function main(): Promise<void> {
  await waitForReady(BASE_URL, HEALTH_TIMEOUT_MS);

  const existing = await readStoredBootstrap();
  if (existing && (await canReuseExisting(existing.adminApiKey))) {
    // OAuth support depends on the booted image, not on the reused credentials — re-probe it so a
    // stale bootstrap file (or an image swap on the same stack) can't pin the wrong answer.
    const oauthSupported = (await tryDiscoverMetadata(BASE_URL)) !== null;
    if (existing.server.oauthSupported !== oauthSupported) {
      await writeStoredBootstrap({ ...existing, server: { ...existing.server, oauthSupported } });
    }
    process.stdout.write(`bootstrap: reusing ${BOOTSTRAP_FILE_PATH}\n`);
    return;
  }

  const sessionId = await ensureAdminSessionId();
  const adminApiKey = await mintApiKey(sessionId, "e2e-admin-key", E2E_GROUPS.ADMIN);
  const client = createClient({
    url: BASE_URL,
    credential: { kind: "apiKey", apiKey: adminApiKey },
  });

  const apiKeyUser = await client.requestParsed(CurrentUser, "/api/user/current");
  const probed = await probeServer(client, { retries: DEFAULT_MAX_RETRIES });
  const seeded = await seedContent(client, libraryReady(probed));
  const oauthSupported = (await tryDiscoverMetadata(BASE_URL)) !== null;
  const server = { ...probed, oauthSupported };

  const limitedGroupId = await createLimitedGroup(client);
  await revokeDefaultCollectionAccess(client, limitedGroupId, seeded.defaultCollectionId);
  const limitedApiKey = await mintApiKey(sessionId, "e2e-limited-key", limitedGroupId);
  const limitedClient = createClient({
    url: BASE_URL,
    credential: { kind: "apiKey", apiKey: limitedApiKey },
  });
  const limitedKeyUser = await limitedClient.requestParsed(CurrentUser, "/api/user/current");
  await assertLimitedKeyCannotQueryOrdersCard(limitedClient, seeded.ordersCardId);

  await captureSnapshot(client);

  await writeStoredBootstrap({
    baseUrl: BASE_URL,
    admin: { email: ADMIN.email, password: ADMIN.password },
    adminApiKey,
    adminApiKeyEmail: apiKeyUser.email,
    limitedApiKey,
    limitedApiKeyEmail: limitedKeyUser.email,
    seeded,
    server,
  });
  process.stdout.write(
    `bootstrap: wrote ${BOOTSTRAP_FILE_PATH} and captured snapshot ${SNAPSHOT_NAME}\n`,
  );
}

async function canReuseExisting(adminApiKey: string): Promise<boolean> {
  const [keyOk, snapshotOk] = await Promise.all([keyStillWorks(adminApiKey), snapshotFileExists()]);
  return keyOk && snapshotOk;
}

async function ensureAdminSessionId(): Promise<string> {
  const direct = await tryLogin();
  if (direct) {
    return direct.id;
  }

  const sessionProps = await postOrGetPreAuthJson(
    `${BASE_URL}/api/session/properties`,
    SessionPropertiesResponse,
    "GET",
  );
  const setupToken = sessionProps["setup-token"];
  if (typeof setupToken !== "string" || setupToken.length === 0) {
    throw new Error(
      "Could not log in as admin and no setup-token is available. " +
        "Wipe state with `bun run e2e:down` if the admin password drifted.",
    );
  }

  await postOrGetPreAuthJson(`${BASE_URL}/api/setup`, z.unknown(), "POST", {
    token: setupToken,
    user: {
      first_name: ADMIN.first_name,
      last_name: ADMIN.last_name,
      email: ADMIN.email,
      password: ADMIN.password,
      site_name: ADMIN.site_name,
    },
    prefs: { site_name: ADMIN.site_name, allow_tracking: false },
    database: null,
  });

  const after = await tryLogin();
  if (!after) {
    throw new Error("admin login failed even after /api/setup completed");
  }
  return after.id;
}

// These requests can't use the api-key `Client`: setup is pre-auth (no key yet) and
// `mintApiKey` authenticates with an `x-metabase-session` header the client doesn't model.
// They still share the client's retry loop via `runWithRetries`.
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  return runWithRetries(async (attempt) => {
    try {
      return { kind: "success", response: await fetch(url, init) };
    } catch (error) {
      if (attempt >= DEFAULT_MAX_RETRIES) {
        const method = init.method ?? "GET";
        throw new Error(
          `${method} ${url} failed after ${attempt + 1} attempts: ${errorMessage(error)}`,
          { cause: error },
        );
      }
      return { kind: "retry", delayMs: backoffDelay({ attempt }) };
    }
  });
}

async function mintApiKey(sessionId: string, namePrefix: string, groupId: number): Promise<string> {
  const response = await fetchWithRetry(`${BASE_URL}/api/api-key`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-metabase-session": sessionId },
    body: JSON.stringify({
      name: `${namePrefix}-${Date.now()}`,
      group_id: groupId,
    }),
  });
  if (!response.ok) {
    throw new Error(`POST /api/api-key -> ${response.status}: ${await response.text()}`);
  }
  return ApiKeyResponse.parse(await response.json()).unmasked_key;
}

async function createLimitedGroup(client: Client): Promise<number> {
  const created = await client.requestParsed(PermissionsGroupResponse, "/api/permissions/group", {
    method: "POST",
    body: { name: LIMITED_GROUP_NAME },
  });
  return created.id;
}

async function revokeDefaultCollectionAccess(
  client: Client,
  limitedGroupId: number,
  defaultCollectionId: number,
): Promise<void> {
  const graph = await client.requestParsed(CollectionGraphResponse, "/api/collection/graph");
  const denyDefaultCollection = {
    [String(defaultCollectionId)]: "none",
  };
  const updated = {
    revision: graph.revision,
    groups: {
      ...graph.groups,
      [String(E2E_GROUPS.ALL_USERS)]: denyDefaultCollection,
      [String(limitedGroupId)]: denyDefaultCollection,
    },
  };
  await client.requestParsed(CollectionGraphResponse, "/api/collection/graph", {
    method: "PUT",
    body: updated,
    idempotent: true,
  });
}

async function assertLimitedKeyCannotQueryOrdersCard(
  client: Client,
  ordersCardId: number,
): Promise<void> {
  try {
    await client.requestParsed(CardQueryResult, `/api/card/${ordersCardId}/query`, {
      method: "POST",
      body: { parameters: [] },
    });
  } catch (error) {
    if (error instanceof HttpError && error.status === 403) {
      return;
    }
    throw error;
  }
  throw new Error(
    "bootstrap precondition failed: limited api key was able to query the orders-by-status card",
  );
}

// Mirrors tests/e2e/server-gate.ts: a null (unparseable head/dev) version counts as the latest, so
// the library round-trip seeds and runs on head images; real sub-59 images parse to a major below
// the floor and skip seeding, since their `/api/ee/library` endpoints don't exist yet.
function libraryReady(server: ServerInfo): boolean {
  if (server.tokenFeatures?.[LIBRARY_FEATURE] !== true) {
    return false;
  }
  return server.version === null || server.version.major >= LIBRARY_MIN_VERSION;
}

async function seedContent(client: Client, libraryEnabled: boolean): Promise<SeededIds> {
  const warehouseDbId = await createEntityId(client, "/api/database", {
    name: WAREHOUSE_DB_NAME,
    engine: "postgres",
    details: WAREHOUSE_CONNECTION,
  });
  await waitForDatabaseSync(client, warehouseDbId);

  const defaultCollectionId = await createEntityId(client, "/api/collection", {
    name: DEFAULT_COLLECTION_NAME,
    color: "#509EE3",
    parent_id: null,
  });

  const ordersCardId = await createEntityId(client, "/api/card", {
    name: ORDERS_BY_STATUS_CARD_NAME,
    display: "table",
    visualization_settings: {},
    collection_id: defaultCollectionId,
    dataset_query: {
      type: "native",
      database: warehouseDbId,
      native: { query: ORDERS_BY_STATUS_SQL },
    },
  });

  const ordersDashboardId = await createEntityId(client, "/api/dashboard", {
    name: ORDERS_OVERVIEW_DASHBOARD_NAME,
    description: ORDERS_OVERVIEW_DASHBOARD_DESCRIPTION,
    collection_id: defaultCollectionId,
  });

  const updated = await client.requestParsed(
    DashboardWithDashcardsResponse,
    `/api/dashboard/${ordersDashboardId}`,
    {
      method: "PUT",
      body: {
        dashcards: [
          {
            id: -1,
            card_id: ordersCardId,
            row: 0,
            col: 0,
            size_x: 12,
            size_y: 6,
            parameter_mappings: [],
            visualization_settings: {},
          },
        ],
        tabs: [],
      },
    },
  );
  const ordersDashcardId = updated.dashcards[0]?.id;
  if (ordersDashcardId === undefined) {
    throw new Error("expected dashboard to have at least one dashcard after PUT");
  }

  const { tables, fields } = await discoverWarehouseSchema(client, warehouseDbId);

  const libraryDataCollectionId = libraryEnabled ? await ensureLibraryDataCollection(client) : null;

  return {
    warehouseDbId,
    defaultCollectionId,
    ordersCardId,
    ordersDashboardId,
    ordersDashcardId,
    tables,
    fields,
    libraryDataCollectionId,
  };
}

const LIBRARY_DATA_COLLECTION_TYPE = "library-data";

// `/api/collection?include-library=true` mixes numeric ids with the virtual `root` string id, so
// the id is a union; real library collections always carry a numeric id.
const LibraryCollectionResponse = z
  .object({
    id: z.union([z.number().int().positive(), z.string()]),
    type: z.string().nullable().optional(),
  })
  .loose();
const LibraryCollectionListResponse = z.array(LibraryCollectionResponse);

// The Library's Data/Metrics collections don't exist until the Library is created. POST
// /api/ee/library/ is the one-time initializer (it 4xxs if already created), so check for the
// `library-data` collection first and only create when absent.
async function ensureLibraryDataCollection(client: Client): Promise<number> {
  const existing = await findLibraryDataCollectionId(client);
  if (existing !== null) {
    return existing;
  }
  await client.requestRaw("/api/ee/library/", { method: "POST" });
  const created = await findLibraryDataCollectionId(client);
  if (created === null) {
    throw new Error("bootstrap: library-data collection missing after POST /api/ee/library/");
  }
  return created;
}

async function findLibraryDataCollectionId(client: Client): Promise<number | null> {
  const collections = await client.requestParsed(LibraryCollectionListResponse, "/api/collection", {
    query: { "include-library": true },
  });
  const dataCollection = collections.find((c) => c.type === LIBRARY_DATA_COLLECTION_TYPE);
  if (dataCollection === undefined) {
    return null;
  }
  if (typeof dataCollection.id !== "number") {
    throw new Error(
      `bootstrap: library-data collection has non-numeric id ${String(dataCollection.id)}`,
    );
  }
  return dataCollection.id;
}

async function createEntityId(client: Client, path: string, body: unknown): Promise<number> {
  const created = await client.requestParsed(EntityWithIdResponse, path, { method: "POST", body });
  return created.id;
}

async function waitForDatabaseSync(client: Client, databaseId: number): Promise<void> {
  await pollUntil(
    async () =>
      client.requestParsed(DatabaseMetadataResponse, `/api/database/${databaseId}/metadata`),
    (metadata) => metadata.tables.length >= SYNC_MIN_TABLES,
    { intervalMs: SYNC_POLL_INTERVAL_MS, timeoutMs: SYNC_TIMEOUT_MS },
  );
}

const WAREHOUSE_TABLE_NAMES = {
  orders: "orders",
  customers: "customers",
  products: "products",
  reviews: "reviews",
  orderItems: "order_items",
  orderSummary: "order_summary",
  dailySales: "daily_sales",
} as const;
const ORDERS_ID_FIELD_NAME = "id";

type WarehouseSchema = Pick<SeededIds, "tables" | "fields">;

async function discoverWarehouseSchema(
  client: Client,
  databaseId: number,
): Promise<WarehouseSchema> {
  const metadata = await client.requestParsed(
    DatabaseMetadataResponse,
    `/api/database/${databaseId}/metadata`,
  );
  const tableIdByName = new Map(metadata.tables.map((table) => [table.name, table.id]));
  const tables = {
    orders: requireTableId(tableIdByName, WAREHOUSE_TABLE_NAMES.orders),
    customers: requireTableId(tableIdByName, WAREHOUSE_TABLE_NAMES.customers),
    products: requireTableId(tableIdByName, WAREHOUSE_TABLE_NAMES.products),
    reviews: requireTableId(tableIdByName, WAREHOUSE_TABLE_NAMES.reviews),
    orderItems: requireTableId(tableIdByName, WAREHOUSE_TABLE_NAMES.orderItems),
    orderSummary: requireTableId(tableIdByName, WAREHOUSE_TABLE_NAMES.orderSummary),
    dailySales: requireTableId(tableIdByName, WAREHOUSE_TABLE_NAMES.dailySales),
  };

  const ordersTable = metadata.tables.find((table) => table.name === WAREHOUSE_TABLE_NAMES.orders);
  const ordersIdField = ordersTable?.fields?.find((field) => field.name === ORDERS_ID_FIELD_NAME);
  if (ordersIdField === undefined) {
    throw new Error(
      `bootstrap: warehouse "orders" table has no "${ORDERS_ID_FIELD_NAME}" field in /api/database/${databaseId}/metadata`,
    );
  }

  return { tables, fields: { ordersId: ordersIdField.id } };
}

function requireTableId(tableIdByName: Map<string, number>, name: string): number {
  const id = tableIdByName.get(name);
  if (id === undefined) {
    const seen = [...tableIdByName.keys()].join(", ");
    throw new Error(
      `bootstrap: warehouse table "${name}" missing from synced metadata (saw: ${seen})`,
    );
  }
  return id;
}

async function captureSnapshot(client: Client): Promise<void> {
  await client.requestRaw(`/api/testing/snapshot/${SNAPSHOT_NAME}`, {
    method: "POST",
    idempotent: true,
  });
}

async function snapshotFileExists(): Promise<boolean> {
  try {
    await fs.stat(SNAPSHOT_FILE_PATH);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

async function waitForReady(baseUrl: string, timeoutMs: number): Promise<void> {
  await pollUntil(
    async (signal) => {
      try {
        const health = await fetch(`${baseUrl}/api/health`, { signal });
        if (!health.ok) {
          return false;
        }
        // /api/health goes green before the app reliably serves real endpoints; gating on
        // the settings endpoint the probe + setup depend on keeps a slow (especially EE)
        // startup from resetting connections mid-bootstrap.
        const properties = await fetch(`${baseUrl}/api/session/properties`, { signal });
        return properties.ok;
      } catch {
        return false;
      }
    },
    (ok) => ok,
    { intervalMs: HEALTH_POLL_INTERVAL_MS, timeoutMs },
  );
}

async function postOrGetPreAuthJson<T>(
  url: string,
  schema: z.ZodType<T>,
  method: "GET" | "POST",
  body?: unknown,
): Promise<T> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const response = await fetchWithRetry(url, init);
  if (!response.ok) {
    throw new Error(`${method} ${url} -> ${response.status}: ${await response.text()}`);
  }
  return schema.parse(await response.json());
}

async function tryLogin(): Promise<z.infer<typeof SessionResponse> | null> {
  const response = await fetchWithRetry(`${BASE_URL}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: ADMIN.email, password: ADMIN.password }),
  });
  if (!response.ok) {
    return null;
  }
  const parsed = SessionResponse.safeParse(await response.json());
  return parsed.success ? parsed.data : null;
}

async function keyStillWorks(apiKey: string): Promise<boolean> {
  const client = createClient({ url: BASE_URL, credential: { kind: "apiKey", apiKey } });
  try {
    await client.requestParsed(CurrentUser, "/api/user/current");
    return true;
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      return false;
    }
    throw error;
  }
}

async function readStoredBootstrap(): Promise<E2EBootstrap | null> {
  let raw: string;
  try {
    raw = await fs.readFile(BOOTSTRAP_FILE_PATH, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
  const parsed = parseJsonResult(raw, Bootstrap, { source: BOOTSTRAP_FILE_PATH });
  if (!parsed.ok) {
    process.stderr.write(
      `bootstrap: ignoring stale ${BOOTSTRAP_FILE_PATH} (${parsed.error.message}); regenerating\n`,
    );
    return null;
  }
  return parsed.value;
}

async function writeStoredBootstrap(data: E2EBootstrap): Promise<void> {
  await fs.writeFile(BOOTSTRAP_FILE_PATH, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`bootstrap failed: ${message}\n`);
  process.exit(1);
});
