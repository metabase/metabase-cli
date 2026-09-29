import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { CardCompact } from "@metabase/client/domain/card";
import { DashboardCompact } from "@metabase/client/domain/dashboard";
import {
  DependencyGraphCompact,
  type DependencyNodeCompact,
  type DependencyType,
} from "@metabase/client/domain/dependency";
import { parseJson } from "@metabase/client/json";
import { pollUntil } from "@metabase/client/poll";

import { DependencyBreakingListEnvelope } from "../../packages/cli/src/commands/dependency/breaking";
import { DependencyBrokenListEnvelope } from "../../packages/cli/src/commands/dependency/broken";
import { DependencyDependentsListEnvelope } from "../../packages/cli/src/commands/dependency/dependents";
import { DependencyUnreferencedListEnvelope } from "../../packages/cli/src/commands/dependency/unreferenced";
import { CommandHelpEntry } from "../../packages/cli/src/runtime/command-help";
import { readBootstrap, type E2EBootstrap, type ServerIdentity } from "./bootstrap-data";
import { cliErrorCategory, cliErrorMessage } from "./cli-error";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { seedProbedProfile } from "./seed-profile";
import { SEEDED } from "./seed/seeded";
import { requirementFailure, requireServer, serverHas } from "./server-gate";

const DEPENDENCIES_REFUSAL =
  "This operation requires the 'dependencies' premium feature (not enabled on this server).";
const DOWNGRADE_REMEDY = "Or install an `@metabase/cli` release that targets this server.";
const DEPENDENCY_TYPES =
  "table, card, snippet, transform, dashboard, document, sandbox, segment, measure";
const CARD_TYPES = "question, model, metric";
const DEFAULT_COLLECTION_NAME = "E2E Default";
const WAREHOUSE_DB_NAME = "Warehouse";
const ORDERS_OVERVIEW_DASHBOARD_NAME = "Orders Overview";
const ORDERS_OVERVIEW_DASHBOARD_DESCRIPTION = "E2E seeded dashboard with one orders dashcard.";
const SCRATCH_CARD_NAME = "Dependency scratch card";
const SCRATCH_DASHBOARD_NAME = "Dependency scratch dashboard";

// The server recomputes the graph in a backfill job it fires a second after a content change, so
// a fresh edge is polled for rather than read back at once.
const BACKFILL_POLL = { intervalMs: 1_000, timeoutMs: 60_000 };

const EMPTY_LIST = {
  data: [],
  returned: 0,
  offset: 0,
  total: 0,
  has_more: false,
  next_offset: null,
};

const skipReason = requireServer("dependency › dependency e2e against EE dependency endpoints", [
  "dependencyItemListings",
  "dependencyGraph",
]);
const listingGap = requirementFailure(["dependencyItemListings"]);

// The listing verbs need a newer server than `graph`, and the preflight reports the version gap
// before the missing token feature.
function listingLiveRefusal(server: ServerIdentity): string {
  if (listingGap?.reason !== "version-too-old") {
    return DEPENDENCIES_REFUSAL;
  }
  if (server.version === null) {
    throw new Error("a server with no parsed version is placed past the window, never below it");
  }
  return `This operation requires Metabase v59+ (this server is ${server.version.tag}). Upgrade Metabase to use it.\n${DOWNGRADE_REMEDY}`;
}

describe("dependency arg validation e2e (no Metabase contact required)", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function makeIsolatedConfigHome(): Promise<string> {
    const dir = await mkTempConfigHome();
    tempDirs.push(dir);
    return dir;
  }

  async function runOffline(...args: string[]) {
    return runCli({
      args: ["dependency", ...args, "--json"],
      configHome: await makeIsolatedConfigHome(),
    });
  }

  it("graph rejects an unknown entity type with ConfigError", async () => {
    const result = await runOffline("graph", "user", "1");

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(
      `invalid type: "user" (expected one of: ${DEPENDENCY_TYPES})`,
    );
    expect(result.stdout).toBe("");
  });

  it("graph rejects a non-integer id with ConfigError", async () => {
    const result = await runOffline("graph", "card", "abc");

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("dependents rejects an unknown --dependent-types member with ConfigError", async () => {
    const result = await runOffline("dependents", "card", "1", "--dependent-types", "card,user");

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(
      `invalid --dependent-types value: user (expected one of: ${DEPENDENCY_TYPES})`,
    );
    expect(result.stdout).toBe("");
  });

  it("broken rejects an unknown --dependent-card-types member with ConfigError", async () => {
    const result = await runOffline("broken", "table", "1", "--dependent-card-types", "table");

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(
      `invalid --dependent-card-types value: table (expected one of: ${CARD_TYPES})`,
    );
    expect(result.stdout).toBe("");
  });

  it("dependents rejects a listing sort column with ConfigError", async () => {
    const result = await runOffline(
      "dependents",
      "card",
      "1",
      "--sort-column",
      "dependents-errors",
    );

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(
      'invalid --sort-column value: "dependents-errors" (expected one of: name, location, view-count)',
    );
    expect(result.stdout).toBe("");
  });

  it("unreferenced rejects a dependents sort column with ConfigError", async () => {
    const result = await runOffline("unreferenced", "--sort-column", "view-count");

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(
      'invalid --sort-column value: "view-count" (expected one of: name, location, dependents-with-errors, dependents-errors)',
    );
    expect(result.stdout).toBe("");
  });

  it("breaking rejects an unknown --sort-direction with ConfigError", async () => {
    const result = await runOffline("breaking", "--sort-direction", "up");

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(
      'invalid --sort-direction value: "up" (expected one of: asc, desc)',
    );
    expect(result.stdout).toBe("");
  });

  it("graph refuses before any request when the cached probe lacks the dependencies feature", async () => {
    const configHome = await makeIsolatedConfigHome();
    await seedProbedProfile(configHome, 64);

    const result = await runCli({
      args: ["dependency", "graph", "card", "1", "--json"],
      configHome,
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorCategory(result.stderr)).toBe("capability");
    expect(cliErrorMessage(result.stderr)).toBe(DEPENDENCIES_REFUSAL);
    expect(result.stdout).toBe("");
  });

  it("unreferenced refuses before any request when the cached probe lacks the dependencies feature", async () => {
    const configHome = await makeIsolatedConfigHome();
    await seedProbedProfile(configHome, 64);

    const result = await runCli({ args: ["dependency", "unreferenced", "--json"], configHome });

    expect(result.exitCode).toBe(2);
    expect(cliErrorCategory(result.stderr)).toBe("capability");
    expect(cliErrorMessage(result.stderr)).toBe(DEPENDENCIES_REFUSAL);
    expect(result.stdout).toBe("");
  });

  it("help --json reports the graph feature behind graph", async () => {
    const result = await runOffline("graph", "--help");

    expect(result.exitCode, result.stderr).toBe(0);
    const entry = parseJson(result.stdout, CommandHelpEntry, { source: "--help --json" });
    expect(entry.requires).toEqual({
      methods: ["dependency.graph"],
      features: ["dependencyGraph"],
    });
  });

  it("help --json reports the listing feature behind breaking", async () => {
    const result = await runOffline("breaking", "--help");

    expect(result.exitCode, result.stderr).toBe(0);
    const entry = parseJson(result.stdout, CommandHelpEntry, { source: "--help --json" });
    expect(entry.requires).toEqual({
      methods: ["dependency.breakingPages"],
      features: ["dependencyItemListings"],
    });
  });
});

describe.skipIf(serverHas("dependencyGraph"))(
  "dependency capability gate against a server without the dependencies feature",
  () => {
    let bootstrap: E2EBootstrap;
    const tempDirs: string[] = [];

    beforeAll(async () => {
      bootstrap = await readBootstrap();
    });

    afterEach(async () => {
      await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
    });

    async function makeIsolatedConfigHome(): Promise<string> {
      const dir = await mkTempConfigHome();
      tempDirs.push(dir);
      return dir;
    }

    async function runLive(verb: string[]) {
      return runCli({
        args: ["dependency", ...verb, "--json"],
        configHome: await makeIsolatedConfigHome(),
        env: { MB_URL: bootstrap.baseUrl, MB_API_KEY: bootstrap.adminApiKey },
      });
    }

    it("graph refuses with CapabilityError (exit 2) after a live probe", async () => {
      const result = await runLive(["graph", "card", String(SEEDED.ordersCardId)]);

      expect(result.exitCode).toBe(2);
      expect(cliErrorCategory(result.stderr)).toBe("capability");
      expect(cliErrorMessage(result.stderr)).toBe(DEPENDENCIES_REFUSAL);
      expect(result.stdout).toBe("");
    });

    it.each([
      ["dependents", "card", String(SEEDED.ordersCardId)],
      ["broken", "table", String(SEEDED.tables.orders)],
      ["unreferenced"],
      ["breaking"],
    ])("%s refuses with CapabilityError (exit 2) after a live probe", async (...verb) => {
      const result = await runLive(verb);

      expect(result.exitCode).toBe(2);
      expect(cliErrorCategory(result.stderr)).toBe("capability");
      expect(cliErrorMessage(result.stderr)).toBe(listingLiveRefusal(bootstrap.server));
      expect(result.stdout).toBe("");
    });
  },
);

describe.skipIf(skipReason !== null)("dependency e2e against EE dependency endpoints", () => {
  let bootstrap: E2EBootstrap;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    bootstrap = await readBootstrap();
  });

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function makeIsolatedConfigHome(): Promise<string> {
    const dir = await mkTempConfigHome();
    tempDirs.push(dir);
    return dir;
  }

  function authEnv(): Record<string, string> {
    return { MB_URL: bootstrap.baseUrl, MB_API_KEY: bootstrap.adminApiKey };
  }

  async function runDependency(...args: string[]) {
    return runCli({
      args: ["dependency", ...args, "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
  }

  async function createOrdersCard(): Promise<number> {
    const result = await runCli({
      args: ["card", "create", "--json"],
      stdin: JSON.stringify({
        name: SCRATCH_CARD_NAME,
        display: "table",
        visualization_settings: {},
        collection_id: SEEDED.defaultCollectionId,
        dataset_query: {
          "lib/type": "mbql/query",
          database: SEEDED.warehouseDbId,
          stages: [{ "lib/type": "mbql.stage/mbql", "source-table": SEEDED.tables.orders }],
        },
      }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    return parseJson(result.stdout, CardCompact).id;
  }

  async function createDashboard(cardId: number | null): Promise<number> {
    const dashcards =
      cardId === null
        ? []
        : [
            {
              id: -1,
              card_id: cardId,
              row: 0,
              col: 0,
              size_x: 12,
              size_y: 6,
              parameter_mappings: [],
              visualization_settings: {},
            },
          ];
    const result = await runCli({
      args: ["dashboard", "create", "--json"],
      stdin: JSON.stringify({
        name: SCRATCH_DASHBOARD_NAME,
        collection_id: SEEDED.defaultCollectionId,
        dashcards,
      }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    return parseJson(result.stdout, DashboardCompact).id;
  }

  async function graphOf(type: DependencyType, id: number): Promise<DependencyGraphCompact> {
    const result = await runDependency("graph", type, String(id));
    expect(result.exitCode, result.stderr).toBe(0);
    return parseJson(result.stdout, DependencyGraphCompact);
  }

  async function dependentsOf(type: DependencyType, id: number, ...flags: string[]) {
    const result = await runDependency("dependents", type, String(id), ...flags);
    expect(result.exitCode, result.stderr).toBe(0);
    return parseJson(result.stdout, DependencyDependentsListEnvelope);
  }

  function defaultCollection() {
    return {
      id: SEEDED.defaultCollectionId,
      name: DEFAULT_COLLECTION_NAME,
      authority_level: null,
      is_personal: false,
    };
  }

  function scratchCardNode(cardId: number): DependencyNodeCompact {
    return {
      id: cardId,
      type: "card",
      data: {
        name: SCRATCH_CARD_NAME,
        description: null,
        type: "question",
        database_id: SEEDED.warehouseDbId,
        collection_id: SEEDED.defaultCollectionId,
        collection: defaultCollection(),
        dashboard_id: null,
        dashboard: null,
        document_id: null,
        document: null,
        view_count: expect.any(Number),
      },
      dependents_count: null,
    };
  }

  function dashboardNode(id: number, name: string, description: string | null) {
    return {
      id,
      type: "dashboard",
      data: {
        name,
        description,
        collection_id: SEEDED.defaultCollectionId,
        collection: defaultCollection(),
        view_count: expect.any(Number),
      },
      dependents_count: null,
    };
  }

  function readsWarehouse(node: DependencyNodeCompact): boolean {
    return (
      node.data.database_id === SEEDED.warehouseDbId || node.data.db_id === SEEDED.warehouseDbId
    );
  }

  it("graph answers a card's upstream table once the backfill has run, the edge running from the card to the table", async () => {
    const cardId = await createOrdersCard();
    const edge = {
      from_entity_type: "card",
      from_entity_id: cardId,
      to_entity_type: "table",
      to_entity_id: SEEDED.tables.orders,
    };

    const graph = await pollUntil(
      () => graphOf("card", cardId),
      (candidate) => candidate.edges.length > 0,
      BACKFILL_POLL,
    );

    expect(graph.edges).toEqual([edge]);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes).toContainEqual(scratchCardNode(cardId));
    expect(graph.nodes).toContainEqual({
      id: SEEDED.tables.orders,
      type: "table",
      data: {
        name: "orders",
        display_name: "Orders",
        description: null,
        db_id: SEEDED.warehouseDbId,
        db: { id: SEEDED.warehouseDbId, name: WAREHOUSE_DB_NAME },
        schema: "public",
      },
      dependents_count: expect.objectContaining({ question: expect.any(Number) }),
    });
  });

  it("dependents answers the dashboard holding a card once the backfill has run", async () => {
    const cardId = await createOrdersCard();
    const dashboardId = await createDashboard(cardId);

    const envelope = await pollUntil(
      () => dependentsOf("card", cardId),
      (candidate) => candidate.returned > 0,
      BACKFILL_POLL,
    );

    expect(envelope).toEqual({
      data: [dashboardNode(dashboardId, SCRATCH_DASHBOARD_NAME, null)],
      returned: 1,
      offset: 0,
      total: 1,
      has_more: false,
      next_offset: null,
    });
  });

  it("dependents --dependent-types keeps only the named kinds", async () => {
    const cardId = await createOrdersCard();
    await createDashboard(cardId);
    await pollUntil(
      () => dependentsOf("card", cardId),
      (candidate) => candidate.returned > 0,
      BACKFILL_POLL,
    );

    const envelope = await dependentsOf("card", cardId, "--dependent-types", "card");

    expect(envelope).toEqual(EMPTY_LIST);
  });

  it("broken answers nothing for a table nothing has broken", async () => {
    const result = await runDependency("broken", "table", String(SEEDED.tables.orders));

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, DependencyBrokenListEnvelope)).toEqual(EMPTY_LIST);
  });

  it("unreferenced --types dashboard lists the seeded dashboard, which nothing depends on", async () => {
    const result = await runDependency("unreferenced", "--types", "dashboard");

    expect(result.exitCode, result.stderr).toBe(0);
    const envelope = parseJson(result.stdout, DependencyUnreferencedListEnvelope);
    expect(envelope.data).toContainEqual(
      dashboardNode(
        SEEDED.ordersDashboardId,
        ORDERS_OVERVIEW_DASHBOARD_NAME,
        ORDERS_OVERVIEW_DASHBOARD_DESCRIPTION,
      ),
    );
    expect(envelope.data.every((node) => node.type === "dashboard")).toBe(true);
    expect(envelope.has_more).toBe(false);
    expect(envelope.total).toBe(envelope.returned);
  });

  // Scoped to the seed's collection: servers before 60 also list the Usage analytics dashboards.
  it("unreferenced pages on the server: --limit 1 answers the first by name with a resumption point, --offset resumes", async () => {
    const scratchId = await createDashboard(null);
    const scope = ["--types", "dashboard", "--query", DEFAULT_COLLECTION_NAME, "--limit", "1"];

    const first = await runDependency("unreferenced", ...scope);
    const second = await runDependency("unreferenced", ...scope, "--offset", "1");

    expect(first.exitCode, first.stderr).toBe(0);
    expect(parseJson(first.stdout, DependencyUnreferencedListEnvelope)).toEqual({
      data: [dashboardNode(scratchId, SCRATCH_DASHBOARD_NAME, null)],
      returned: 1,
      offset: 0,
      limit: 1,
      total: 2,
      has_more: true,
      next_offset: 1,
    });
    expect(second.exitCode, second.stderr).toBe(0);
    expect(parseJson(second.stdout, DependencyUnreferencedListEnvelope)).toEqual({
      data: [
        dashboardNode(
          SEEDED.ordersDashboardId,
          ORDERS_OVERVIEW_DASHBOARD_NAME,
          ORDERS_OVERVIEW_DASHBOARD_DESCRIPTION,
        ),
      ],
      returned: 1,
      offset: 1,
      limit: 1,
      total: 2,
      has_more: false,
      next_offset: null,
    });
  });

  it("unreferenced --query matches names case-insensitively", async () => {
    const scratchId = await createDashboard(null);

    const result = await runDependency(
      "unreferenced",
      "--types",
      "dashboard",
      "--query",
      "SCRATCH",
    );

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, DependencyUnreferencedListEnvelope)).toEqual({
      data: [dashboardNode(scratchId, SCRATCH_DASHBOARD_NAME, null)],
      returned: 1,
      offset: 0,
      total: 1,
      has_more: false,
      next_offset: null,
    });
  });

  // The Usage analytics content can carry query errors of its own, so only the warehouse is asserted.
  it("breaking names no warehouse source when no seeded dependent carries a query error", async () => {
    const result = await runDependency("breaking");

    expect(result.exitCode, result.stderr).toBe(0);
    const envelope = parseJson(result.stdout, DependencyBreakingListEnvelope);
    expect(envelope.data.filter(readsWarehouse)).toEqual([]);
  });

  it("graph of a missing entity is Not found (exit 1)", async () => {
    const result = await runDependency("graph", "card", "9999999");

    expect(result.exitCode).toBe(1);
    expect(cliErrorMessage(result.stderr)).toBe(
      "Not found: GET /api/ee/dependencies/graph?type=card&id=9999999.",
    );
    expect(result.stdout).toBe("");
  });
});
