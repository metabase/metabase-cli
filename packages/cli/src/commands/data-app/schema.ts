import { z } from "zod";

import { ConfigError } from "@metabase/client/errors";

import { writeRawStdout } from "../../output/stream";
import { parseCsv } from "../../runtime/csv";
import { connectionFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

const TypedSchemaModule = z.string().describe("The generated TypeScript module, metabase.data.ts.");

export default defineMetabaseCommand({
  meta: {
    name: "schema",
    description: "Print the TypeScript semantic schema a data app queries through",
  },
  details:
    "Prints the generated `metabase.data.ts` module to stdout; redirect it into the app's `src/`. Pick the narrowest scope that covers the app: --database for one database's tables, or the library scopes (combinable with each other, not with --database). Add --include-models when the app runs actions, which the schema lists under the models they belong to.",
  skills: [
    {
      skill: "data-app-semantic-layer",
      purpose: "choose the scope and query the generated schema",
    },
  ],
  requires: ["dataApp.schema"],
  args: {
    ...profileFlag,
    ...connectionFlags,
    database: { type: "string", description: "Database id or name" },
    libraryCollections: {
      type: "string",
      description: "Comma-separated library collection ids or entity ids",
      alias: "library-collections",
    },
    includeDataLibrary: {
      type: "boolean",
      description: "The whole Library / Data tree",
      alias: "include-data-library",
    },
    includeMetricLibrary: {
      type: "boolean",
      description: "The whole Library / Metrics tree",
      alias: "include-metric-library",
    },
    includeModels: {
      type: "boolean",
      description: "Readable models with actions (scoped by --database when given)",
      alias: "include-models",
    },
  },
  outputSchema: TypedSchemaModule,
  examples: [
    "mb data-app schema --include-data-library > src/metabase.data.ts",
    "mb data-app schema --database 1 --include-models > src/metabase.data.ts",
  ],
  async run({ args, getClient }) {
    const libraryCollections =
      args.libraryCollections === undefined ? undefined : parseCsv(args.libraryCollections);
    const libraryScoped =
      libraryCollections !== undefined ||
      args.includeDataLibrary === true ||
      args.includeMetricLibrary === true;
    if (args.database !== undefined && libraryScoped) {
      throw new ConfigError(
        "--database cannot be combined with --library-collections, --include-data-library or --include-metric-library",
      );
    }
    const client = await getClient();
    const module = await client.dataApp.schema({
      ...(args.database === undefined ? {} : { database: args.database }),
      ...(libraryCollections === undefined ? {} : { libraryCollections }),
      ...(args.includeDataLibrary === true ? { includeDataLibrary: true } : {}),
      ...(args.includeMetricLibrary === true ? { includeMetricLibrary: true } : {}),
      ...(args.includeModels === true ? { includeModels: true } : {}),
    });
    writeRawStdout(module);
  },
});
