import { runCommand } from "citty";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { parseJson } from "@metabase/client/json";

import { getQuerySchemaBundle } from "../core/schema/validate";
import main from "../main";
import { getMetabaseAugment } from "../runtime/command-augment";
import { buildHelpIndex, resolveCommandPath } from "../runtime/command-help";
import schemaCommand from "./schema";

interface SchemaRun {
  stdout: string;
  stderr: string;
  exitCode: number | string | null | undefined;
}

async function runSchema(rawArgs: readonly string[]): Promise<SchemaRun> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
  process.stdout.isTTY = false;
  process.exitCode = undefined;
  try {
    await runCommand(schemaCommand, { rawArgs: [...rawArgs] });
    return { stdout: stdout.join(""), stderr: stderr.join(""), exitCode: process.exitCode };
  } finally {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  }
}

const NamedDefs = z.object({ $defs: z.record(z.string(), z.unknown()) });

const DescribedProperties = z.object({
  properties: z.object({ dataset_query: z.object({ description: z.string() }) }),
});

const RequiredKeys = z.object({ required: z.array(z.string()) });

describe("schema command", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints a command's body as TypeScript by default, down a pipe too", async () => {
    const run = await runSchema(["transform-tag", "create"]);

    expect(run).toEqual({
      stdout:
        "// Objects accept keys beyond the ones listed.\ntype Input = {\nname: string // non-empty\n}\n",
      stderr: "",
      exitCode: undefined,
    });
  });

  it("prints what a command prints under --output", async () => {
    const run = await runSchema(["schema", "--output"]);

    expect(run.stdout).toBe(
      "// The JSON Schema (draft 2020-12) of the command's body or output\ntype Output = Record<string, unknown>\n",
    );
  });

  it("names the client's shared schemas as $defs under --json", async () => {
    const run = await runSchema(["card", "create", "--json"]);

    expect(Object.keys(parseJson(run.stdout, NamedDefs).$defs)).toEqual([
      "__schema0",
      "Parameter",
      "ParameterTarget",
      "__schema1",
      "__schema2",
      "ParameterMapping",
    ]);
  });

  it("keeps the descriptions the client's schemas carry beside the names", async () => {
    const run = await runSchema(["card", "create", "--json"]);

    expect(parseJson(run.stdout, DescribedProperties).properties.dataset_query.description).toBe(
      "MBQL 5, legacy MBQL, or native query",
    );
  });

  it("converts the body as input, so a defaulted field is not required", async () => {
    const run = await runSchema(["alert", "create", "--json"]);

    expect(parseJson(run.stdout, RequiredKeys).required).toEqual([
      "payload",
      "subscriptions",
      "handlers",
    ]);
  });

  it("prints the MBQL 5 schema bundle as it is for query under --json", async () => {
    const run = await runSchema(["query", "--json"]);

    expect(parseJson(run.stdout, z.unknown())).toEqual(getQuerySchemaBundle());
  });

  it("resolves a group by its alias", async () => {
    const byAlias = await runSchema(["database", "list", "--output"]);
    const byName = await runSchema(["db", "list", "--output"]);

    expect(byAlias.stdout).toBe(byName.stdout);
  });

  it("refuses a group, naming its commands", async () => {
    const run = await runSchema(["card", "--format", "text"]);

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain(
      "card is a command group; name one of its commands: list, get, query, alerts, create, update, verify, archive",
    );
  });

  it("refuses a command path that names no command", async () => {
    const run = await runSchema(["card", "creat", "--format", "text"]);

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain("unknown command: card creat");
  });

  it("refuses the input of a command that takes no body, pointing at --output", async () => {
    const run = await runSchema(["card", "get", "--format", "text"]);

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain(
      "card get takes no JSON body, so it has no input schema; pass --output for the schema of what it prints",
    );
  });
});

interface CommandSchemas {
  readonly segments: readonly string[];
  readonly input: string | null;
  readonly output: string;
}

const LEAVES = (await buildHelpIndex(main, [])).commands.map((entry) => entry.command);

let cachedSchemas: Promise<ReadonlyMap<string, CommandSchemas>> | null = null;

function allSchemas(): Promise<ReadonlyMap<string, CommandSchemas>> {
  cachedSchemas ??= readAllSchemas();
  return cachedSchemas;
}

// One command at a time: each run captures the process's own stdout.
async function readAllSchemas(): Promise<ReadonlyMap<string, CommandSchemas>> {
  const schemas = new Map<string, CommandSchemas>();
  for (const command of LEAVES) {
    schemas.set(command, await readSchemas(command.split(" ")));
  }
  return schemas;
}

async function readSchemas(segments: readonly string[]): Promise<CommandSchemas> {
  const augment = getMetabaseAugment(await resolveCommandPath(main, segments));
  const takesBody = augment !== null && (augment.inputSchema ?? augment.inputJsonSchema) !== null;
  const input = takesBody ? (await runSchema(segments)).stdout : null;
  const output = (await runSchema([...segments, "--output"])).stdout;
  return { segments, input, output };
}

function snapshotText(schemas: CommandSchemas): string {
  const command = `mb schema ${schemas.segments.join(" ")}`;
  const input = schemas.input === null ? [] : [`// ${command}`, schemas.input];
  return [...input, `// ${command} --output`, schemas.output].join("\n");
}

describe("schema snapshots", () => {
  it.each(LEAVES)("%s", async (command) => {
    const schemas = (await allSchemas()).get(command);
    if (schemas === undefined) {
      throw new Error(`no schemas read for ${command}`);
    }
    await expect(snapshotText(schemas)).toMatchFileSnapshot(
      `__snapshots__/schema/${schemas.segments.join("/")}.snap`,
    );
  });

  it("compiles every printed schema under the TypeScript compiler", async () => {
    const files = new Map<string, string>();
    for (const schemas of (await allSchemas()).values()) {
      const base = `/schema/${schemas.segments.join("/")}`;
      if (schemas.input !== null) {
        files.set(`${base}.input.ts`, schemas.input);
      }
      files.set(`${base}.output.ts`, schemas.output);
    }

    expect(compileErrors(files)).toEqual([]);
  });
});

const COMPILER_OPTIONS: ts.CompilerOptions = {
  noEmit: true,
  strict: true,
  skipLibCheck: true,
  types: [],
  lib: ["lib.es2023.d.ts"],
  moduleDetection: ts.ModuleDetectionKind.Force,
};

function compileErrors(files: ReadonlyMap<string, string>): string[] {
  const host = ts.createCompilerHost(COMPILER_OPTIONS);
  const readFile = host.readFile.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.fileExists = (name) => files.has(name) || ts.sys.fileExists(name);
  host.readFile = (name) => files.get(name) ?? readFile(name);
  host.getSourceFile = (name, version, onError) => {
    const text = files.get(name);
    return text === undefined
      ? getSourceFile(name, version, onError)
      : ts.createSourceFile(name, text, version);
  };
  const program = ts.createProgram([...files.keys()], COMPILER_OPTIONS, host);
  return ts.getPreEmitDiagnostics(program).map((diagnostic) => {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    return `${diagnostic.file?.fileName ?? "<program>"}: ${message}`;
  });
}
