import { z } from "zod";

import { writeText } from "../../output/render";
import { writeProjectFile } from "../../runtime/data-app-project";
import { connectionFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { parseSlug, slugArg } from "./slug";

const TypedSchemaModule = z
  .string()
  .describe("The generated TypeScript module of the app's queries and actions.");

export default defineMetabaseCommand({
  meta: {
    name: "typed-schema",
    description: "Print or write the TypeScript module of a data app's queries and actions",
  },
  details:
    "Metabase generates a `defineQuery` call for every question and a `defineAction` call for every action in the app's collection, each typed by its result columns or parameters and addressed by entity ID, exported as `queries` and `actions`. Fetch it again after any change to the collection. --out writes it to a file (the app's `src/metabase.ts`) instead of stdout.",
  skills: [
    { skill: "data-app-actions", purpose: "the actions the module defines" },
    { skill: "data-app-data", purpose: "the questions the module defines" },
  ],
  requires: ["dataApp.typedSchema"],
  args: {
    ...profileFlag,
    ...connectionFlags,
    ...slugArg,
    out: { type: "string", description: "File to write the module to" },
  },
  outputSchema: TypedSchemaModule,
  examples: [
    "mb data-app typed-schema sales-overview --out src/metabase.ts",
    "mb data-app typed-schema sales-overview > src/metabase.ts",
  ],
  async run({ args, getClient }) {
    const slug = parseSlug(args.slug);
    const client = await getClient();
    const module = await client.dataApp.typedSchema(slug);
    if (args.out === undefined) {
      writeText(module.trimEnd());
      return;
    }
    await writeProjectFile(args.out, module);
    writeText(`Wrote the queries and actions of data app ${slug} to ${args.out}.`);
  },
});
