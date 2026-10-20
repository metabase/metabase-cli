import type { CommandDef } from "citty";
import { z, type ZodType } from "zod";

import { CollectionTreeNode } from "@metabase/client/domain/collection";
import { Dashcard, DashboardTab } from "@metabase/client/domain/dashboard";
import { TipTapNode } from "@metabase/client/domain/document";
import { FieldBaseType, FieldSemanticType } from "@metabase/client/domain/field";
import { Parameter, ParameterMapping, ParameterTarget } from "@metabase/client/domain/parameter";
import { ConfigError } from "@metabase/client/errors";

import { QuerySchemaBundle } from "../core/schema/validate";
import main from "../main";
import { writeJson, writeText } from "../output/render";
import { renderTypeScript } from "../output/schema-ts";
import { resolveCitty } from "../runtime/citty";
import {
  getMetabaseAugment,
  type JsonSchemaSource,
  type MetabaseAugment,
} from "../runtime/command-augment";
import { resolveCommandPath } from "../runtime/command-help";
import { defineMetabaseCommand } from "./runtime";

const TYPE_NAMES = { input: "Input", output: "Output" } as const;
type Side = keyof typeof TYPE_NAMES;

// Each shape here recurs across commands, or reaches itself, and goes by the client's own name for
// it, so a declaration reads as the type an importer of the client sees.
const NAMED_SCHEMAS = {
  Parameter,
  ParameterMapping,
  ParameterTarget,
  Dashcard,
  DashboardTab,
  CollectionTreeNode,
  TipTapNode,
  FieldBaseType,
  FieldSemanticType,
};

// Zod reads every schema's metadata from the one registry it is handed, so the names sit over the
// global registry, where the client's `.describe()` calls write, rather than hiding it.
class SchemaNames extends z.core.$ZodRegistry<z.core.GlobalMeta> {
  readonly #ids: ReadonlyMap<z.core.$ZodType, string>;

  constructor(named: Readonly<Record<string, z.core.$ZodType>>) {
    super();
    this.#ids = new Map(Object.entries(named).map(([id, schema]) => [schema, id]));
  }

  override get<S extends z.core.$ZodType>(
    schema: S,
  ): z.core.$replace<z.core.GlobalMeta, S> | undefined {
    const described = z.globalRegistry.get(schema);
    const id = this.#ids.get(schema);
    return id === undefined ? described : { ...described, id };
  }
}

const SCHEMA_NAMES = new SchemaNames(NAMED_SCHEMAS);

interface ZodContract {
  readonly kind: "zod";
  readonly schema: ZodType;
  readonly side: Side;
}

interface DocumentContract {
  readonly kind: "documents";
  readonly source: JsonSchemaSource;
}

type Contract = ZodContract | DocumentContract;

const PrintedSchema = z
  .union([z.object({ $schema: z.string() }).loose(), QuerySchemaBundle])
  .describe(
    "The JSON Schema (draft 2020-12) of the command's body or output; for query's body, the MBQL 5 schema documents",
  );

export default defineMetabaseCommand({
  meta: {
    name: "schema",
    description: "Print the schema of a command's JSON body or output",
  },
  details:
    "Names another command and prints the JSON body it accepts as TypeScript type declarations, or with --output the JSON it prints. It prints TypeScript unless --json is passed, down a pipe too, since TypeScript is the compact view to read before writing a body or parsing a result. --json prints the JSON Schema instead, for a validator. A member marked `?` may be left out, and a trailing `//` comment carries what the type cannot say: integer, length and range bounds, formats, patterns, defaults, and the field's description. `mb schema query` prints the MBQL 5 query schema that query, card, transform, segment, measure and data-action bodies are checked against.",
  requires: null,
  args: {
    json: { type: "boolean", description: "Print the JSON Schema instead of TypeScript" },
    output: {
      type: "boolean",
      description: "Print the schema of the command's output instead of its body",
    },
    command: {
      type: "positional",
      required: true,
      description: "The command, or the group holding it (card, query, …)",
    },
    subcommand: {
      type: "positional",
      required: false,
      description: "The command within that group (create, get, …)",
    },
  },
  outputSchema: PrintedSchema,
  examples: [
    "mb schema card create",
    "mb schema dashboard get --output",
    "mb schema card create --json",
    "mb schema query",
  ],
  async run({ args }) {
    const path = args.subcommand === undefined ? [args.command] : [args.command, args.subcommand];
    const side: Side = args.output === true ? "output" : "input";
    if (args.json === true) {
      writeJson(await schemaJson(path, side));
      return;
    }
    writeText(await schemaTypeScript(path, side));
  },
});

export async function schemaTypeScript(path: readonly string[], side: Side): Promise<string> {
  return contractTypeScript(await resolveContract(path, side));
}

export async function schemaJson(path: readonly string[], side: Side): Promise<unknown> {
  return contractJson(await resolveContract(path, side));
}

async function resolveContract(path: readonly string[], side: Side): Promise<Contract> {
  const command = await resolveLeaf(path);
  const contract = readContract(getMetabaseAugment(command), side);
  if (contract === null) {
    throw missingSchema(path.join(" "), side);
  }
  return contract;
}

async function resolveLeaf(path: readonly string[]): Promise<CommandDef> {
  const command = await resolveCommandPath(main, path);
  const subCommands = await resolveCitty(command.subCommands);
  if (subCommands === undefined) {
    return command;
  }
  const named = path.join(" ");
  const names = Object.keys(subCommands).join(", ");
  throw new ConfigError(`${named} is a command group; name one of its commands: ${names}`);
}

function readContract(augment: MetabaseAugment | null, side: Side): Contract | null {
  if (augment === null) {
    return null;
  }
  if (side === "input" && augment.inputJsonSchema !== null) {
    return { kind: "documents", source: augment.inputJsonSchema };
  }
  const schema = side === "input" ? augment.inputSchema : augment.outputSchema;
  return schema === null ? null : { kind: "zod", schema, side };
}

function missingSchema(command: string, side: Side): ConfigError {
  if (side === "output") {
    return new ConfigError(`${command} declares no output schema`);
  }
  return new ConfigError(
    `${command} takes no JSON body, so it has no input schema; pass --output for the schema of what it prints`,
  );
}

function contractJson(contract: Contract): unknown {
  if (contract.kind === "documents") {
    return contract.source.bundle;
  }
  return z.toJSONSchema(contract.schema, {
    io: contract.side,
    reused: "ref",
    metadata: SCHEMA_NAMES,
  });
}

function contractTypeScript(contract: Contract): string {
  if (contract.kind === "zod") {
    return renderTypeScript(contractJson(contract), { name: TYPE_NAMES[contract.side] });
  }
  const { documentName, bundle } = contract.source;
  return renderTypeScript(bundle.schema, {
    name: TYPE_NAMES.input,
    documentName,
    documents: bundle.defs,
  });
}
