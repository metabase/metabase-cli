import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { DocumentCompact } from "@metabase/client/domain/document";
import { parseJson } from "@metabase/client/json";

import { DocumentListEnvelope } from "../../packages/cli/src/commands/document/list";
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorCategory, cliErrorMessage } from "./cli-error";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { seedProbedProfile } from "./seed-profile";
import { SEEDED } from "./seed/seeded";
import { serverHas } from "./server-gate";

const DOC_NAME = "e2e_document";
const RENAMED = "e2e_document_renamed";
const COPY_NAME = "e2e_document_copy";

const DOWNGRADE_REMEDY = "Or install an `@metabase/cli` release that targets this server.";

function copyRefusal(serverTag: string | undefined): string {
  return `This operation requires Metabase v59+ (this server is ${serverTag}). Upgrade Metabase to use it.\n${DOWNGRADE_REMEDY}`;
}

const ProjectedDocumentBody = z.strictObject({
  name: z.string(),
  document: z.unknown(),
});

const DOC_BODY = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: { _id: "11111111-1111-4111-8111-111111111111" },
      content: [{ type: "text", text: "Hello from the e2e suite." }],
    },
  ],
};

interface CreateDocumentBody {
  name: string;
  collection_id: number;
  document: typeof DOC_BODY;
}

const CREATE_BODY: CreateDocumentBody = {
  name: DOC_NAME,
  collection_id: SEEDED.defaultCollectionId,
  document: DOC_BODY,
};

describe("document e2e", () => {
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
    return {
      MB_URL: bootstrap.baseUrl,
      MB_API_KEY: bootstrap.adminApiKey,
    };
  }

  async function createDocument(): Promise<DocumentCompact> {
    const result = await runCli({
      args: ["document", "create", "--json"],
      stdin: JSON.stringify(CREATE_BODY),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const created = parseJson(result.stdout, DocumentCompact);
    expect(created).toEqual({
      id: expect.any(Number),
      name: DOC_NAME,
      collection_id: SEEDED.defaultCollectionId,
      archived: false,
      creator_id: expect.any(Number),
      can_write: true,
    });
    return created;
  }

  it("create then get returns the same compact document by id", async () => {
    const created = await createDocument();

    const result = await runCli({
      args: ["document", "get", String(created.id), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, DocumentCompact)).toEqual(created);
  });

  it("list includes the just-created document with its compact projection", async () => {
    const created = await createDocument();

    const result = await runCli({
      args: ["document", "list", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const envelope = parseJson(result.stdout, DocumentListEnvelope);
    const match = envelope.data.find((doc) => doc.id === created.id);
    expect(match).toEqual(created);
  });

  it("update changes the name and the change is visible via get", async () => {
    const created = await createDocument();

    const updateResult = await runCli({
      args: ["document", "update", String(created.id), "--json"],
      stdin: JSON.stringify({ name: RENAMED }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(updateResult.exitCode, updateResult.stderr).toBe(0);
    expect(parseJson(updateResult.stdout, DocumentCompact)).toEqual({ ...created, name: RENAMED });

    const getResult = await runCli({
      args: ["document", "get", String(created.id), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(getResult.exitCode, getResult.stderr).toBe(0);
    expect(parseJson(getResult.stdout, DocumentCompact)).toEqual({ ...created, name: RENAMED });
  });

  it("archive flips archived and drops the document from the default list", async () => {
    const created = await createDocument();

    const archiveResult = await runCli({
      args: ["document", "archive", String(created.id), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(archiveResult.exitCode, archiveResult.stderr).toBe(0);
    expect(parseJson(archiveResult.stdout, DocumentCompact)).toEqual({
      ...created,
      archived: true,
    });

    const listResult = await runCli({
      args: ["document", "list", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(listResult.exitCode, listResult.stderr).toBe(0);
    const envelope = parseJson(listResult.stdout, DocumentListEnvelope);
    expect(envelope.data.find((doc) => doc.id === created.id)).toBeUndefined();
  });

  it("create with a body missing the required document field fails Zod validation", async () => {
    const result = await runCli({
      args: ["document", "create", "--json"],
      stdin: JSON.stringify({ name: "missing-body" }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("request body: value did not match expected schema");
    expect(result.stdout).toBe("");
  });

  it("create rejects a document whose node is missing its _id", async () => {
    const result = await runCli({
      args: ["document", "create", "--json"],
      stdin: JSON.stringify({
        name: "missing-node-id",
        collection_id: SEEDED.defaultCollectionId,
        document: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }],
        },
      }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("request body: value did not match expected schema");
    expect(result.stdout).toBe("");
  });

  it("get with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["document", "get", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("get against a missing id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["document", "get", "9999999", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Not found: GET /api/document/9999999.");
  });

  async function copyDocument(sourceId: number, ...flags: string[]) {
    return runCli({
      args: ["document", "copy", String(sourceId), ...flags, "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
  }

  it("copy lands a copy in the root collection with the source name and body, or refuses on a server without the route", async () => {
    const created = await createDocument();
    const result = await copyDocument(created.id);

    if (serverHas("documentCopy")) {
      expect(result.exitCode, result.stderr).toBe(0);
      const copy = parseJson(result.stdout, DocumentCompact);
      expect(copy).toEqual({ ...created, id: expect.any(Number), collection_id: null });
      expect(copy.id).not.toBe(created.id);

      const bodyResult = await runCli({
        args: ["document", "get", String(copy.id), "--fields", "name,document", "--json"],
        configHome: await makeIsolatedConfigHome(),
        env: authEnv(),
      });
      expect(bodyResult.exitCode, bodyResult.stderr).toBe(0);
      expect(parseJson(bodyResult.stdout, ProjectedDocumentBody)).toEqual({
        name: DOC_NAME,
        document: DOC_BODY,
      });
      return;
    }
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(copyRefusal(bootstrap.server.version?.tag));
  });

  it("copy --name --collection-id files the copy under the seeded collection with the new name, or refuses on a server without the route", async () => {
    const created = await createDocument();
    const result = await copyDocument(
      created.id,
      "--name",
      COPY_NAME,
      "--collection-id",
      String(SEEDED.defaultCollectionId),
    );

    if (serverHas("documentCopy")) {
      expect(result.exitCode, result.stderr).toBe(0);
      expect(parseJson(result.stdout, DocumentCompact)).toEqual({
        ...created,
        id: expect.any(Number),
        name: COPY_NAME,
      });
      return;
    }
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(copyRefusal(bootstrap.server.version?.tag));
  });

  it("copy of an archived source surfaces a 404 HttpError, or refuses on a server without the route", async () => {
    const created = await createDocument();
    const archiveResult = await runCli({
      args: ["document", "archive", String(created.id), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(archiveResult.exitCode, archiveResult.stderr).toBe(0);

    const result = await copyDocument(created.id);

    if (serverHas("documentCopy")) {
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(`Not found: POST /api/document/${created.id}/copy.`);
      return;
    }
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(copyRefusal(bootstrap.server.version?.tag));
  });

  it("copy refuses before any request when the cached probe says v58", async () => {
    const configHome = await makeIsolatedConfigHome();
    await seedProbedProfile(configHome, 58);

    const result = await runCli({
      args: ["document", "copy", "1", "--json"],
      configHome,
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorCategory(result.stderr)).toBe("capability");
    expect(cliErrorMessage(result.stderr)).toBe(copyRefusal("v0.58.0"));
    expect(result.stdout).toBe("");
  });

  it("copy with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["document", "copy", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });
});
