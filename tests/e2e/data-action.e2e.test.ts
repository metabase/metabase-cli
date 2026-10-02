import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  DataAction,
  type DataActionCreateInput,
  DataActionExecuteResult,
} from "@metabase/client/domain/data-action";
import { createTransport, type Transport } from "@metabase/client/http/transport";
import { parseJson } from "@metabase/client/json";
import { z } from "zod";

import { DataActionListEnvelope } from "../../packages/cli/src/commands/data-action/list";
import { DeleteResult } from "../../packages/cli/src/commands/delete-runtime";
import { USER_AGENT } from "../../packages/cli/src/core/user-agent";
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorCategory, cliErrorMessage } from "./cli-error";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { SEEDED } from "./seed/seeded";
import { requireServer, serverHas } from "./server-gate";

const DOWNGRADE_REMEDY = "Or install an `@metabase/cli` release that targets this server.";

const ACTION_NAME = "Touch customer";

// Rewrites a column to its own value, so a run affects one row without changing the warehouse.
const TOUCH_CUSTOMER_SQL = "UPDATE customers SET full_name = full_name WHERE id = {{customer_id}}";

function createBody(): DataActionCreateInput {
  return {
    name: ACTION_NAME,
    type: "query",
    database_id: SEEDED.warehouseDbId,
    collection_id: SEEDED.defaultCollectionId,
    dataset_query: {
      "lib/type": "mbql/query",
      database: SEEDED.warehouseDbId,
      stages: [
        {
          "lib/type": "mbql.stage/native",
          native: TOUCH_CUSTOMER_SQL,
          "template-tags": {
            customer_id: {
              id: "customer_id",
              name: "customer_id",
              "display-name": "Customer ID",
              type: "number",
              required: true,
            },
          },
        },
      ],
    },
    parameters: [
      {
        id: "customer_id",
        slug: "customer_id",
        name: "Customer ID",
        type: "number/=",
        target: ["variable", ["template-tag", "customer_id"]],
        required: true,
      },
    ],
  };
}

const skipReason = requireServer("data-action › data-action e2e", ["dataActionsWithoutModel"]);

describe.skipIf(skipReason !== null)("data-action e2e", () => {
  let bootstrap: E2EBootstrap;
  let adminClient: Transport;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    bootstrap = await readBootstrap();
    adminClient = createTransport(
      { url: bootstrap.baseUrl, credential: { kind: "apiKey", apiKey: bootstrap.adminApiKey } },
      { userAgent: USER_AGENT },
    );
  });

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function cli(args: string[], stdin?: string) {
    const configHome = await mkTempConfigHome();
    tempDirs.push(configHome);
    return runCli({
      args,
      ...(stdin === undefined ? {} : { stdin }),
      configHome,
      env: { MB_URL: bootstrap.baseUrl, MB_API_KEY: bootstrap.adminApiKey },
    });
  }

  async function enableActionsOnWarehouse(): Promise<void> {
    await adminClient.requestParsed(z.unknown(), `/api/database/${SEEDED.warehouseDbId}`, {
      method: "PUT",
      body: { settings: { "database-enable-actions": true } },
    });
  }

  async function createAction(): Promise<DataAction> {
    const result = await cli(
      ["data-action", "create", "--json", "--full"],
      JSON.stringify(createBody()),
    );
    expect(result.exitCode, result.stderr).toBe(0);
    return parseJson(result.stdout, DataAction);
  }

  it("create is refused while actions are off on the database", async () => {
    const result = await cli(["data-action", "create", "--json"], JSON.stringify(createBody()));

    expect(result.exitCode).not.toBe(0);
    expect(cliErrorMessage(result.stderr)).toContain("Actions are not enabled.");
    expect(result.stdout).toBe("");
  });

  it("create files a model-less query action in its collection, and list and get read it back", async () => {
    await enableActionsOnWarehouse();

    const created = await createAction();
    expect(created).toMatchObject({
      name: ACTION_NAME,
      type: "query",
      model_id: null,
      database_id: SEEDED.warehouseDbId,
      collection_id: SEEDED.defaultCollectionId,
      archived: false,
    });

    const listed = await cli(["data-action", "list", "--json"]);
    expect(listed.exitCode, listed.stderr).toBe(0);
    expect(parseJson(listed.stdout, DataActionListEnvelope).data).toEqual([
      {
        id: created.id,
        name: ACTION_NAME,
        type: "query",
        collection_id: SEEDED.defaultCollectionId,
        database_id: SEEDED.warehouseDbId,
        archived: false,
      },
    ]);

    const fetched = await cli(["data-action", "get", String(created.id), "--json", "--full"]);
    expect(fetched.exitCode, fetched.stderr).toBe(0);
    expect(parseJson(fetched.stdout, DataAction)).toMatchObject({
      id: created.id,
      parameters: [expect.objectContaining({ id: "customer_id", type: "number/=" })],
    });
  });

  it("execute runs the write with the parameter values and reports the rows it affected", async () => {
    await enableActionsOnWarehouse();
    const created = await createAction();

    const result = await cli(
      ["data-action", "execute", String(created.id), "--json"],
      JSON.stringify({ parameters: { customer_id: 1 } }),
    );

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, DataActionExecuteResult)).toEqual({ "rows-affected": 1 });
  });

  it("execute without a required parameter is refused by the server", async () => {
    await enableActionsOnWarehouse();
    const created = await createAction();

    const result = await cli(
      ["data-action", "execute", String(created.id), "--json"],
      JSON.stringify({ parameters: {} }),
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
  });

  it("update renames, archive hides it from list, and delete removes it", async () => {
    await enableActionsOnWarehouse();
    const created = await createAction();

    const renamed = await cli(
      ["data-action", "update", String(created.id), "--json", "--full"],
      JSON.stringify({ name: "Touch a customer" }),
    );
    expect(renamed.exitCode, renamed.stderr).toBe(0);
    expect(parseJson(renamed.stdout, DataAction).name).toBe("Touch a customer");

    const archived = await cli(["data-action", "archive", String(created.id), "--json", "--full"]);
    expect(archived.exitCode, archived.stderr).toBe(0);
    expect(parseJson(archived.stdout, DataAction).archived).toBe(true);

    const listed = await cli(["data-action", "list", "--json"]);
    expect(listed.exitCode, listed.stderr).toBe(0);
    expect(parseJson(listed.stdout, DataActionListEnvelope).data).toEqual([]);

    const deleted = await cli(["data-action", "delete", String(created.id), "--yes", "--json"]);
    expect(deleted.exitCode, deleted.stderr).toBe(0);
    expect(parseJson(deleted.stdout, DeleteResult)).toEqual({
      id: created.id,
      deleted: true,
      aborted: false,
    });
  });
});

describe.skipIf(serverHas("dataActionsWithoutModel"))(
  "data-action on servers that need a model",
  () => {
    let bootstrap: E2EBootstrap;
    const tempDirs: string[] = [];

    beforeAll(async () => {
      bootstrap = await readBootstrap();
    });

    afterEach(async () => {
      await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
    });

    it("create refuses with CapabilityError (exit 2) after a live probe, before sending the body", async () => {
      const configHome = await mkTempConfigHome();
      tempDirs.push(configHome);

      const result = await runCli({
        args: ["data-action", "create", "--json"],
        stdin: JSON.stringify(createBody()),
        configHome,
        env: { MB_URL: bootstrap.baseUrl, MB_API_KEY: bootstrap.adminApiKey },
      });

      if (bootstrap.server.version === null) {
        throw new Error(
          "a server with no parsed version is placed past the window, never below it",
        );
      }
      expect(result.exitCode).toBe(2);
      expect(cliErrorCategory(result.stderr)).toBe("capability");
      expect(cliErrorMessage(result.stderr)).toBe(
        `This operation requires Metabase v65+ (this server is ${bootstrap.server.version.tag}). Upgrade Metabase to use it.\n${DOWNGRADE_REMEDY}`,
      );
      expect(result.stdout).toBe("");
    });
  },
);
