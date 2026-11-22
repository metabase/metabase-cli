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
import { writeJson } from "../output/render";
import { resolveCitty } from "../runtime/citty";
import {
  type EmbeddedQuery,
  getMetabaseAugment,
  type MetabaseAugment,
  type SchemaContract,
} from "../runtime/command-augment";
import { CLI_NAME, resolveCommandPath } from "../runtime/command-help";
import { NOTE_SEPARATOR, notePaths, type PathNote, toJsonSchema } from "../runtime/json-schema";
import { formatFlags, profileFlag, urlFlag } from "./flags";
import { defineMetabaseCommand } from "./runtime";

type Side = "input" | "output";

interface GateNotes {
  readonly server: ServerProfile | null;
}

// Each shape here recurs across commands, or reaches itself, and goes by the client's own name for
// it, so its `$defs` entry reads as the type an importer of the client sees.
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
  needs: { claim: "needs", verdict: "this server lacks it" },
  supersededBy: { claim: "read differently under", verdict: "this server reads it differently" },
  droppedBy: { claim: "dropped by", verdict: "this server ignores it" },
} as const satisfies Record<GateEffect, GateEffectText>;

interface GateEffectText {
  readonly claim: string;
  readonly verdict: string;
}

function gateNote(gate: InputGate, server: ServerProfile | null): string {
  const text = GATE_EFFECT_TEXT[gate.effect];
  const feature = `${gate.feature} (${featureAvailability(gate.feature)})`;
  const trigger = triggerText(gate.when);
  const claim = `${text.claim} ${feature}`;
  const note = trigger === null ? claim : `${claim} ${trigger}`;
  return server !== null && serverActsOnGate(gate, server) ? `${note}; ${text.verdict}` : note;
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

function serverActsOnGate(gate: InputGate, server: ServerProfile): boolean {
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
  details: [
    `Prints the JSON Schema of the body another command reads, or with \`--output\` of what it prints. A body field that only some servers take names its feature in its description (\`needs fieldDataSensitivity (${featureAvailability("fieldDataSensitivity")})\`), and the profile's cached probe, read with no request, adds a verdict: \`this server lacks it\`, \`this server reads it differently\`, or \`this server ignores it\`. A field holding an MBQL 5 query names \`mb schema query\`, the schema such queries are checked against.`,
    "The schema is JSON Schema (draft 2020-12), printed as JSON only. A command path resolves aliases as the command line does.",
    "A defaulted body field isn't `required`. A schema that recurs across commands, such as a dashboard parameter, is declared once under `$defs`. A tuple keeps its arity (`minItems`, and `items: false` when it takes no more), and a rule that JSON Schema can't express is noted in the `description` as `refined: <message>`.",
    `A note can name the values or the state it applies to: \`needs tableUserValueWithdrawal (${featureAvailability("tableUserValueWithdrawal")}) for null\`, \`needs dashboardSubscriptionFilters (${featureAvailability("dashboardSubscriptionFilters")}) when non-empty\`. A value that some servers take as something else reads \`read differently under tableDataLayerTiers (${featureAvailability("tableDataLayerTiers")}) for "gold", …\`, and a field they drop unread reads \`dropped by tableFromDefinition (${featureAvailability("tableFromDefinition")})\`.`,
    "Without a cached probe for the server (the profile has none, or `--url` names another server), the notes have no verdict. Either way, the server decides what it accepts. An output schema has no feature notes.",
    "`mb schema query` prints the MBQL 5 query schema, from a pinned `@metabase/representations` release with every id narrowed to a positive integer, as a bundle, `{ schema, defs }`, whose `$ref`s point into `defs` by file name (`id.yaml`, `ref.yaml`, …). To validate with a validator such as Ajv, call `addSchema(defs[name], name)` for each file, then `compile(schema)`. [`mb query`](query.md) describes the check.",
    "`0` on success. `2` when the path names no command, or a group (the error lists its commands); when the command has no body schema, or with `--output` no output schema; or with `--format text`.",
  ].join("\n\n"),
  requires: null,
  args: {
    ...formatFlags,
    ...profileFlag,
    ...urlFlag,
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
  examples: ["mb schema card create", "mb schema dashboard get --output", "mb schema query"],
  async run({ args }) {
    // `auto` resolves to text on a terminal, and the schema is JSON there too.
    if (args.format === "text") {
      throw new ConfigError("schema output is JSON-only; --format text is not supported");
    }
    const path = args.subcommand === undefined ? [args.command] : [args.command, args.subcommand];
    const side: Side = args.output === true ? "output" : "input";
    const server = side === "input" ? await cachedServer(args.profile, args.url) : null;
    writeJson(await schemaJson(path, side, { server }));
  },
});

async function cachedServer(
  profile: string | undefined,
  url: string | undefined,
): Promise<ServerProfile | null> {
  const cached = await readCachedServerProfile(resolveProfileName(profile), url);
  return cached.kind === "found" ? cached.profile : null;
}

export async function schemaJson(
  path: readonly string[],
  side: Side,
  gateNotes: GateNotes,
): Promise<unknown> {
  return contractJson(await resolveContract(path, side), side, gateNotes);
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

function contractJson(contract: SchemaContract, side: Side, gateNotes: GateNotes): unknown {
  if (contract.kind === "documents") {
    return contract.source.bundle;
  }
  const names = side === "input" ? new SchemaNames(NAMED_SCHEMAS, gateNotes) : SCHEMA_NAMES;
  const json = toJsonSchema(contract.schema, { io: side, reused: "ref", metadata: names });
  return notePaths(json, embeddedQueryNotes(contract.embedded));
}

function embeddedQueryNotes(embedded: readonly EmbeddedQuery[]): PathNote[] {
  return embedded.map(({ path, documents }) => ({
    path,
    note: `${documents.title} checked against \`${CLI_NAME} schema ${documents.command.join(" ")}\``,
  }));
}
