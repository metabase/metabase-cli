import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DocumentListEnvelope } from "../../src/commands/document/list";
import { DocumentCompact } from "../../src/domain/document";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorMessage } from "./cli-error";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { SEEDED } from "./seed/seeded";

const DOC_NAME = "e2e_document";
const RENAMED = "e2e_document_renamed";

const DOC_BODY = {
  type: "doc",
  attrs: { _id: "11111111-1111-4111-8111-111111111111" },
  content: [
    {
      type: "paragraph",
      attrs: { _id: "22222222-2222-4222-8222-222222222222" },
      content: [
        {
          type: "text",
          text: "Hello from the e2e suite.",
          attrs: { _id: "33333333-3333-4333-8333-333333333333" },
        },
      ],
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
      METABASE_URL: bootstrap.baseUrl,
      METABASE_API_KEY: bootstrap.adminApiKey,
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
});
