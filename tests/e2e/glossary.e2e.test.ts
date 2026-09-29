import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  Glossary,
  GlossaryCompact,
  type GlossaryCreateInput,
} from "@metabase/client/domain/glossary";
import { parseJson } from "@metabase/client/json";

import { DeleteResult } from "../../packages/cli/src/commands/delete-runtime";
import { GlossaryListEnvelope } from "../../packages/cli/src/commands/glossary/list";
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorCategory, cliErrorMessage } from "./cli-error";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";

const CHURN = { term: "Churn", definition: "Customers lost in a calendar month" } as const;
const ACTIVE = {
  term: "Active customer",
  definition: "Placed an order in the last 90 days",
} as const;
const REPLACED = {
  term: "Churn rate",
  definition: "Churned customers over the opening count",
} as const;

// The creator is the api-key user, whose name is the key the bootstrap generated and whose
// `last_name` Metabase sets to "", so the email is the only field the bootstrap can pin exactly.
const CreatedEntry = Glossary.pick({
  id: true,
  term: true,
  definition: true,
  creator_id: true,
  creator: true,
}).strict();
const CREATED_FIELDS = [
  "id",
  "term",
  "definition",
  "creator_id",
  "creator.id",
  "creator.email",
  "creator.first_name",
  "creator.last_name",
].join(",");

describe("glossary e2e", () => {
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

  async function createEntry(entry: GlossaryCreateInput): Promise<GlossaryCompact> {
    const result = await runCli({
      args: [
        "glossary",
        "create",
        "--term",
        entry.term,
        "--definition",
        entry.definition,
        "--json",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    return parseJson(result.stdout, GlossaryCompact);
  }

  async function listEntries(args: readonly string[] = []) {
    const result = await runCli({
      args: ["glossary", "list", ...args, "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    return parseJson(result.stdout, GlossaryListEnvelope);
  }

  it("list on the fresh snapshot is empty", async () => {
    expect(await listEntries()).toEqual({
      data: [],
      returned: 0,
      offset: 0,
      total: 0,
      has_more: false,
      next_offset: null,
    });
  });

  it("create from flags answers the entry with its creator hydrated as the api-key user", async () => {
    const result = await runCli({
      args: [
        "glossary",
        "create",
        "--term",
        CHURN.term,
        "--definition",
        CHURN.definition,
        "--fields",
        CREATED_FIELDS,
        "--json",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const created = parseJson(result.stdout, CreatedEntry);
    expect(created).toEqual({
      id: expect.any(Number),
      ...CHURN,
      creator_id: created.creator.id,
      creator: {
        id: expect.any(Number),
        email: bootstrap.adminApiKeyEmail,
        first_name: expect.any(String),
        last_name: "",
      },
    });
  });

  it("create from a JSON body prints the text summary", async () => {
    const result = await runCli({
      args: ["glossary", "create", "--body", JSON.stringify(CHURN), "--format", "text"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const [created] = (await listEntries()).data;
    if (created === undefined) {
      throw new Error("the created entry is missing from the list");
    }
    expect(created).toEqual({ id: expect.any(Number), ...CHURN });
    expect(result.stdout).toBe(`Created glossary entry ${created.id} "${CHURN.term}".`);
  });

  it("list orders entries by term and --search matches a term or a definition case-insensitively", async () => {
    const churn = await createEntry(CHURN);
    const active = await createEntry(ACTIVE);

    expect((await listEntries()).data).toEqual([active, churn]);
    expect((await listEntries(["--search", "CHURN"])).data).toEqual([churn]);
    expect((await listEntries(["--search", "last 90 days"])).data).toEqual([active]);
    expect((await listEntries(["--search", "revenue"])).data).toEqual([]);
  });

  it("update replaces both the term and the definition", async () => {
    const churn = await createEntry(CHURN);

    const result = await runCli({
      args: ["glossary", "update", String(churn.id), "--body", JSON.stringify(REPLACED), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, GlossaryCompact)).toEqual({ id: churn.id, ...REPLACED });
    expect((await listEntries()).data).toEqual([{ id: churn.id, ...REPLACED }]);
  });

  it("delete --yes removes the entry and a later list omits it", async () => {
    const churn = await createEntry(CHURN);

    const result = await runCli({
      args: ["glossary", "delete", String(churn.id), "--yes", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, DeleteResult)).toEqual({
      deleted: true,
      aborted: false,
      id: churn.id,
    });
    expect((await listEntries()).data).toEqual([]);
  });

  it("update of a missing id is a 404 HttpError", async () => {
    const result = await runCli({
      args: ["glossary", "update", "9999999", "--body", JSON.stringify(REPLACED), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(cliErrorCategory(result.stderr)).toBe("http");
    expect(cliErrorMessage(result.stderr)).toBe("Not found: PUT /api/glossary/9999999.");
    expect(result.stdout).toBe("");
  });

  it("create with --term alone refuses before any request", async () => {
    const result = await runCli({
      args: ["glossary", "create", "--term", CHURN.term, "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: { MB_URL: bootstrap.baseUrl },
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorCategory(result.stderr)).toBe("config");
    expect(cliErrorMessage(result.stderr)).toBe("--definition is required when using --term");
    expect(result.stdout).toBe("");
  });

  it("create with a body that carries a key beyond term and definition is refused by the strict schema", async () => {
    const result = await runCli({
      args: [
        "glossary",
        "create",
        "--body",
        JSON.stringify({ ...CHURN, owner: "finance" }),
        "--json",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(cliErrorCategory(result.stderr)).toBe("validation");
    expect(cliErrorMessage(result.stderr)).toBe(
      'request body: value did not match expected schema\n  /: Unrecognized key: "owner"',
    );
    expect(result.stdout).toBe("");
  });

  it("update with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["glossary", "update", "abc", "--body", JSON.stringify(REPLACED), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorCategory(result.stderr)).toBe("config");
    expect(cliErrorMessage(result.stderr)).toBe('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("delete without --yes refuses in non-TTY and exits 2", async () => {
    const churn = await createEntry(CHURN);

    const result = await runCli({
      args: ["glossary", "delete", String(churn.id), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorCategory(result.stderr)).toBe("config");
    expect(cliErrorMessage(result.stderr)).toBe(
      `refusing to delete ${churn.id} without confirmation — pass --yes to proceed non-interactively`,
    );
    expect(result.stdout).toBe("");
    expect((await listEntries()).data).toEqual([churn]);
  });
});
