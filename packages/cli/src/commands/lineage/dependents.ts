import { ConfigError } from "@metabase/client/errors";
import {
  type EntityRef,
  LineageType,
  type LineageType as LineageTypeValue,
  walkDependents,
} from "../../core/lineage";
import { renderList } from "../../output/render";
import { warn } from "../../output/notice";
import { listEnvelopeSchema } from "../../output/types";
import { dependentView, DependentCompact } from "../../output/views/dependent";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export const DependentsEnvelope = listEnvelopeSchema(DependentCompact);

export default defineMetabaseCommand({
  meta: { name: "dependents", description: "List Metabase entities downstream of a table" },
  details:
    "Finds a physical table by schema and name, then walks every downstream dependency. --types filters the returned entities without pruning intermediate paths.",
  capabilities: { minVersion: 61, tokenFeature: "dependencies" },
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
    database: { type: "string", description: "Metabase database id or name (optional)" },
    schema: { type: "string", description: "Physical table schema", required: true },
    table: { type: "string", description: "Physical table name", required: true },
    types: {
      type: "string",
      description: "Returned dependency types, comma separated (default: all)",
    },
  },
  outputSchema: DependentsEnvelope,
  examples: [
    "mb lineage dependents --schema reporting --table orders",
    "mb lineage dependents --database Analytics --schema reporting --table orders --types question,dashboard",
  ],
  async run({ args, ctx, getClient }) {
    const requestedTypes = parseTypes(args.types);
    const client = await getClient();
    const databases = (await client.database.list()).data.filter((database) =>
      matchesDatabase(database.id, database.name, args.database),
    );
    if (databases.length === 0) {
      throw new ConfigError(`no Metabase database matches --database "${args.database}"`);
    }

    const candidates = (
      await Promise.all(
        databases.map((database) => client.database.schemaTables(database.id, args.schema)),
      )
    ).flatMap(({ data }) => data.filter((table) => equalName(table.name, args.table)));
    if (candidates.length === 0) {
      throw new ConfigError(`table not found: ${args.schema}.${args.table}`);
    }
    if (candidates.length > 1) {
      const ids = candidates.map((table) => `${table.db_id}:${table.id}`).join(", ");
      throw new ConfigError(
        `multiple Metabase tables match ${args.schema}.${args.table} (${ids}); pass --database`,
      );
    }

    const table = candidates[0];
    if (table === undefined) {
      throw new ConfigError(`table not found: ${args.schema}.${args.table}`);
    }
    const root: EntityRef = { type: "table", id: table.id };
    const dependents = await walkDependents(client.dependency.dependents, root);
    const filtered = dependents.filter((dependent) => requestedTypes.has(dependent.type));

    const status = await client.dependency.backfillStatus();
    if (!status.complete) {
      warn("Metabase is still indexing dependencies; dependents may be incomplete.");
    }
    renderList(windowList(filtered, ctx.range), dependentView, ctx);
  },
});

function parseTypes(raw: string | undefined): Set<LineageTypeValue> {
  if (raw === undefined) {
    return new Set(LineageType);
  }
  const values = raw.split(",").map((value) => value.trim());
  const invalid = values.filter((value) => !isLineageType(value));
  if (invalid.length > 0 || values.length === 0) {
    throw new ConfigError(`invalid --types value: "${raw}" (expected: ${LineageType.join(", ")})`);
  }
  return new Set(values.filter(isLineageType));
}

function isLineageType(value: string): value is LineageTypeValue {
  return LineageType.some((candidate) => candidate === value);
}

function equalName(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

function matchesDatabase(id: number, name: string, filter: string | undefined): boolean {
  if (filter === undefined) {
    return true;
  }
  return String(id) === filter || equalName(name, filter);
}
