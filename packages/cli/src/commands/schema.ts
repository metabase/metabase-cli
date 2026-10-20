import type { CommandDef } from "citty";
import { z } from "zod";

import { CollectionTreeNode } from "@metabase/client/domain/collection";
import { Dashcard, DashboardTab } from "@metabase/client/domain/dashboard";
import { TipTapNode } from "@metabase/client/domain/document";
import { FieldBaseType, FieldSemanticType } from "@metabase/client/domain/field";
import { Parameter, ParameterMapping, ParameterTarget } from "@metabase/client/domain/parameter";
import { ConfigError } from "@metabase/client/errors";
import { featureAvailability } from "@metabase/client/version/features";
import {
  type GateEffect,
  type GateTrigger,
  type InputGate,
  inputGatesOf,
} from "@metabase/client/version/input-gates";
import type { ServerProfile } from "@metabase/client/version/profile";

import { readCachedServerProfile } from "../core/auth/cached-server";
import { resolveProfileName } from "../core/config";

import { QuerySchemaBundle } from "../core/schema/validate";
import main from "../main";
import { writeJson, writeText } from "../output/render";
import {
  NOTE_SEPARATOR,
  type PathNote,
  renderTypeScript,
  type RenderOptions,
} from "../output/schema-ts";
import { resolveCitty } from "../runtime/citty";
import {
  type EmbeddedDocument,
  getMetabaseAugment,
  type MetabaseAugment,
  type SchemaContract,
} from "../runtime/command-augment";
import { CLI_NAME, resolveCommandPath } from "../runtime/command-help";
import { toJsonSchema } from "../runtime/json-schema";
import { profileFlag, urlFlag } from "./flags";
import { defineMetabaseCommand } from "./runtime";

const TYPE_NAMES = { input: "Input", output: "Output" } as const;
type Side = keyof typeof TYPE_NAMES;

interface GateNotes {
  readonly server: ServerProfile | null;
}

interface TypeScriptOptions extends Pick<RenderOptions, "strict">, GateNotes {}

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
  readonly #gateNotes: GateNotes | null;

  constructor(named: Readonly<Record<string, z.core.$ZodType>>, gateNotes: GateNotes | null) {
    super();
    this.#ids = new Map(Object.entries(named).map(([id, schema]) => [schema, id]));
    this.#gateNotes = gateNotes;
  }

  override get<S extends z.core.$ZodType>(
    schema: S,
  ): z.core.$replace<z.core.GlobalMeta, S> | undefined {
    const described = z.globalRegistry.get(schema);
    const id = this.#ids.get(schema);
    const named = id === undefined ? described : { ...described, id };
    const gates = inputGatesOf(schema);
    if (this.#gateNotes === null || gates === null) {
      return named;
    }
    const { server } = this.#gateNotes;
    const prior = described?.description === undefined ? [] : [described.description];
    const notes = gates.map((gate) => gateNote(gate, server));
    return { ...named, description: [...prior, ...notes].join(NOTE_SEPARATOR) };
  }
}

const SCHEMA_NAMES = new SchemaNames(NAMED_SCHEMAS, null);

const GATE_EFFECT_TEXT = {
  needs: { claim: "needs", refusal: "this server rejects it" },
  supersededBy: { claim: "read differently under", refusal: "this server reads it differently" },
} as const satisfies Record<GateEffect, GateEffectText>;

interface GateEffectText {
  readonly claim: string;
  readonly refusal: string;
}

function gateNote(gate: InputGate, server: ServerProfile | null): string {
  const text = GATE_EFFECT_TEXT[gate.effect];
  const availability = featureAvailability(gate.feature);
  const feature = availability === null ? gate.feature : `${gate.feature} (${availability})`;
  const trigger = triggerText(gate.when);
  const claim = `${text.claim} ${feature}`;
  const note = trigger === null ? claim : `${claim} ${trigger}`;
  return server !== null && serverRefuses(gate, server) ? `${note}; ${text.refusal}` : note;
}

function triggerText(when: GateTrigger): string | null {
  switch (when.kind) {
    case "present": {
      return null;
    }
    case "values": {
      return `for ${when.values.map((value) => JSON.stringify(value)).join(", ")}`;
    }
    case "nonEmpty": {
      return "when non-empty";
    }
  }
}

function serverRefuses(gate: InputGate, server: ServerProfile): boolean {
  const holds = server.features[gate.feature];
  return gate.effect === "needs" ? !holds : holds;
}

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
    "Names another command and prints the JSON body it accepts as TypeScript type declarations, or with --output the JSON it prints. It prints TypeScript unless --json is passed, down a pipe too, since TypeScript is the compact view to read before writing a body or parsing a result. --json prints the JSON Schema instead, for a validator. A member marked `?` may be left out, and a trailing `//` comment carries what the type cannot say: integer, length and range bounds, formats, patterns, defaults, the field's description, and, on a field only some servers take, the feature it needs, as `needs fieldDataSensitivity (v64+)`. Those notes are judged against the server the profile last probed, read from its cache with no request: `this server rejects it` follows a field that server refuses, and `this server reads it differently` a value it would take as another. `mb schema query` prints the MBQL 5 query schema that query, card, transform, segment, measure and data-action bodies are checked against.",
  requires: null,
  args: {
    ...profileFlag,
    ...urlFlag,
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
    const cached = await readCachedServerProfile(resolveProfileName(args.profile), args.url);
    const server = cached.kind === "found" ? cached.profile : null;
    writeText(await schemaTypeScript(path, side, { server }));
  },
});

export async function schemaTypeScript(
  path: readonly string[],
  side: Side,
  options: TypeScriptOptions,
): Promise<string> {
  return contractTypeScript(await resolveContract(path, side), side, options);
}

export async function schemaJson(path: readonly string[], side: Side): Promise<unknown> {
  return contractJson(await resolveContract(path, side), side);
}

async function resolveContract(path: readonly string[], side: Side): Promise<SchemaContract> {
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

function readContract(augment: MetabaseAugment | null, side: Side): SchemaContract | null {
  if (augment === null) {
    return null;
  }
  if (side === "input") {
    return augment.input;
  }
  if (augment.outputSchema === null) {
    return null;
  }
  return { kind: "zod", schema: augment.outputSchema, embedded: [] };
}

function missingSchema(command: string, side: Side): ConfigError {
  if (side === "output") {
    return new ConfigError(`${command} declares no output schema`);
  }
  return new ConfigError(
    `${command} takes no JSON body, so it has no input schema; pass --output for the schema of what it prints`,
  );
}

function contractJson(
  contract: SchemaContract,
  side: Side,
  names: SchemaNames = SCHEMA_NAMES,
): unknown {
  if (contract.kind === "documents") {
    return contract.source.bundle;
  }
  return toJsonSchema(contract.schema, { io: side, reused: "ref", metadata: names });
}

function contractTypeScript(
  contract: SchemaContract,
  side: Side,
  { server, ...mode }: TypeScriptOptions,
): string {
  if (contract.kind === "zod") {
    const names = side === "input" ? new SchemaNames(NAMED_SCHEMAS, { server }) : SCHEMA_NAMES;
    return renderTypeScript(contractJson(contract, side, names), {
      ...mode,
      name: TYPE_NAMES[side],
      notes: contract.embedded.map(embeddedNote),
    });
  }
  const { documentName, bundle } = contract.source;
  return renderTypeScript(bundle.schema, {
    ...mode,
    name: TYPE_NAMES[side],
    documentName,
    documents: bundle.defs,
  });
}

function embeddedNote(embedded: EmbeddedDocument): PathNote {
  const { title, command } = embedded.source;
  return {
    path: embedded.path,
    note: `${title} checked against \`${CLI_NAME} schema ${command.join(" ")}\``,
  };
}
