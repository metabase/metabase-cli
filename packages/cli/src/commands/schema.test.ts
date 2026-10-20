import { runCommand } from "citty";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { parseJson } from "@metabase/client/json";
import { createServerProfile, type ServerProfile } from "@metabase/client/version/profile";

import { probeAt } from "../core/auth/temp-config-home";
import { getQuerySchemaBundle } from "../core/schema/validate";
import main from "../main";
import { getMetabaseAugment } from "../runtime/command-augment";
import { resolveCitty } from "../runtime/citty";
import { buildHelpIndex, resolveCommandPath } from "../runtime/command-help";
import schemaCommand, { schemaTypeScript } from "./schema";

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
    const run = await runSchema(["transform-tag", "create", "--output"]);

    expect(run.stdout).toBe(
      [
        "// Objects accept keys beyond the ones listed.",
        "type Output = {",
        "id: number // int",
        "name: string",
        "entity_id: string | null",
        "built_in_type: string | null",
        "}",
        "",
      ].join("\n"),
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
      'MBQL 5, legacy MBQL, or native query; refined: dataset_query must include "lib/type" (MBQL 5) or "type" (legacy MBQL/native); empty `{}` is rejected',
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

    expect(byName.exitCode).toBe(undefined);
    expect(byName.stderr).toBe("");
    expect(byAlias).toEqual(byName);
  });

  it("refuses a group, naming its commands", async () => {
    const run = await runSchema(["card"]);

    expect(run.exitCode).toBe(2);
    expect(errorEnvelopeOf(run)).toEqual(
      configErrorEnvelope(
        "card is a command group; name one of its commands: list, get, query, alerts, create, update, verify, archive",
      ),
    );
  });

  it("refuses a command path that names no command", async () => {
    const run = await runSchema(["card", "creat"]);

    expect(run.exitCode).toBe(2);
    expect(errorEnvelopeOf(run)).toEqual(configErrorEnvelope("unknown command: card creat"));
  });

  it("refuses the input of a command that takes no body, pointing at --output", async () => {
    const run = await runSchema(["card", "get"]);

    expect(run.exitCode).toBe(2);
    expect(errorEnvelopeOf(run)).toEqual(
      configErrorEnvelope(
        "card get takes no JSON body, so it has no input schema; pass --output for the schema of what it prints",
      ),
    );
  });
});

const SENSITIVITY_NOTE = "// needs fieldDataSensitivity (v64+)";

function serverAt(
  major: number,
  tokenFeatures: Record<string, boolean> | null = null,
): ServerProfile {
  return createServerProfile(probeAt(major, tokenFeatures));
}

async function inputLine(
  segments: readonly string[],
  server: ServerProfile | null,
  member: string,
): Promise<string | undefined> {
  const rendered = await schemaTypeScript(segments, "input", { server });
  return rendered.split("\n").find((line) => line.startsWith(`${member}?:`));
}

describe("gate notes", () => {
  it("keeps the plain note on a field the cached server takes", async () => {
    const plain = await schemaTypeScript(["field", "update"], "input", { server: null });

    expect(plain.split("\n")).toContain(SENSITIVITY_NOTE);
    expect(await schemaTypeScript(["field", "update"], "input", { server: serverAt(64) })).toBe(
      plain,
    );
  });

  it("says the cached server rejects a field it lacks the feature for", async () => {
    const plain = await schemaTypeScript(["field", "update"], "input", { server: null });

    expect(await schemaTypeScript(["field", "update"], "input", { server: serverAt(63) })).toBe(
      plain.replace(`${SENSITIVITY_NOTE}\n`, `${SENSITIVITY_NOTE}; this server rejects it\n`),
    );
  });

  it("says the cached server reads a superseded value differently", async () => {
    expect(await inputLine(["table", "update"], serverAt(59), "data_layer")).toBe(
      'data_layer?: "final" | "internal" | "hidden" | "gold" | "silver" | "bronze" | "copper" | null // needs tableDataLayerTiers (v59+) for "final", "internal", "hidden"; read differently under tableDataLayerTiers (v59+) for "gold", "silver", "bronze", "copper"; this server reads it differently',
    );
  });

  it("says the cached server rejects a field its token does not grant", async () => {
    expect(await inputLine(["subscription", "create"], serverAt(64), "parameters")).toBe(
      "parameters?: Parameter[] // needs dashboardSubscriptionFilters (token dashboard_subscription_filters) when non-empty; this server rejects it",
    );
  });

  it("keeps the plain note where the cached server's token grants the feature", async () => {
    const granted = serverAt(64, { dashboard_subscription_filters: true });

    expect(await inputLine(["subscription", "create"], granted, "parameters")).toBe(
      "parameters?: Parameter[] // needs dashboardSubscriptionFilters (token dashboard_subscription_filters) when non-empty",
    );
  });
});

function errorEnvelopeOf(run: SchemaRun): unknown {
  return parseJson(run.stderr, z.unknown(), { source: "stderr" });
}

function configErrorEnvelope(message: string): unknown {
  return { ok: false, error: { category: "config", message, exitCode: 2 } };
}

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

async function readAllSchemas(): Promise<ReadonlyMap<string, CommandSchemas>> {
  const schemas = new Map<string, CommandSchemas>();
  for (const command of LEAVES) {
    schemas.set(command, await readSchemas(command.split(" ")));
  }
  return schemas;
}

// Strict, so a JSON Schema keyword the renderer does not handle fails here instead of dropping out
// of the printed type.
async function readSchemas(segments: readonly string[]): Promise<CommandSchemas> {
  const augment = getMetabaseAugment(await resolveCommandPath(main, segments));
  const takesBody = augment !== null && augment.input !== null;
  const input = takesBody
    ? await schemaTypeScript(segments, "input", { strict: true, server: null })
    : null;
  const output = await schemaTypeScript(segments, "output", { strict: true, server: null });
  return { segments, input, output };
}

function snapshotText(schemas: CommandSchemas): string {
  const command = `mb schema ${schemas.segments.join(" ")}`;
  const input = schemas.input === null ? [] : [`// ${command}\n${schemas.input}`];
  return `${[...input, `// ${command} --output\n${schemas.output}`].join("\n\n")}\n`;
}

describe("checked documents", () => {
  it("names the documents a body is checked against on exactly the commands taking --skip-validate", async () => {
    const checking: string[] = [];
    const skippable: string[] = [];
    for (const command of LEAVES) {
      const leaf = await resolveCommandPath(main, command.split(" "));
      const input = getMetabaseAugment(leaf)?.input ?? null;
      if (input !== null && (input.kind === "documents" || input.embedded.length > 0)) {
        checking.push(command);
      }
      const args = await resolveCitty(leaf.args);
      if (args !== undefined && "skip-validate" in args) {
        skippable.push(command);
      }
    }

    expect(checking).toEqual(skippable);
  });
});

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
