import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Client } from "@metabase/cli/client";
import { Collection, CollectionCompact, Library, LibraryCompact } from "@metabase/cli/domain";
import { type Static, Type } from "typebox";
import { z } from "zod";
import { assertCapabilities, type ToolCapabilities } from "./capability";
import type { MetabaseToolDeps } from "./deps";
import { readSkillsFirst, type SkillName } from "./skill-prereq";
import { TeachingError } from "./teaching-error";
import { guardTool, jsonResult, type TextToolResult } from "./tool-result";

export const LIBRARY_CAPABILITIES: ToolCapabilities = { minVersion: 59, tokenFeature: "library" };

const TOOL_NAME = "library";
const SKILLS: readonly SkillName[] = ["library"];
const LIBRARY_ROOT_PATH = "/api/ee/library/";
const PUBLISH_PATH = "/api/ee/data-studio/table/publish-tables";
const UNPUBLISH_PATH = "/api/ee/data-studio/table/unpublish-tables";
const LIBRARY_DATA_TYPE = "library-data";

const ACTIONS = ["get", "publish", "unpublish"] as const;
type Action = (typeof ACTIONS)[number];

const AbsentLibrary = z.object({ data: z.null() });
const LibraryOrAbsent = z.union([Library, AbsentLibrary]);
const CollectionList = z.array(Collection);
const PublishResult = z.object({ target_collection: Collection.nullable() });

const parameters = Type.Object({
  action: Type.Unsafe<Action>({
    type: "string",
    enum: [...ACTIONS],
    description:
      "`get` the Library and its Data / Metrics collection ids · `publish` tables into it · `unpublish` tables from it. `publish` and `unpublish` need at least one selector.",
  }),
  table_ids: Type.Optional(
    Type.Array(Type.Integer(), { description: "Tables to publish or unpublish." }),
  ),
  database_ids: Type.Optional(
    Type.Array(Type.Integer(), {
      description: "Every table in these databases. Combined with the other selectors.",
    }),
  ),
  schema_ids: Type.Optional(
    Type.Array(Type.String(), {
      description:
        'Every table in these schemas, each named `"<database id>:<schema>"` — e.g. `"1:public"`. Combined with the other selectors.',
    }),
  ),
});

export function libraryTool(deps: MetabaseToolDeps): ToolDefinition {
  return defineTool({
    name: TOOL_NAME,
    label: "Library",
    description:
      `${readSkillsFirst(SKILLS)}\n\n` +
      "Curate the Library — the instance's shortlist of trusted data. A published table comes first in every data picker and ranks up in search, so publishing is how you tell everyone else's questions which tables to build on; it is the last step of a modeling job, after the table is named, described and typed with `metadata_write`.\n\n" +
      "`publish` carries a table's upstream dependencies with it (a published table whose sources are not published would be trusted data resting on invisible data), and `unpublish` carries its downstream dependents. So both do more than the tables you name — say which tables you are about to publish before you publish a whole database.\n\n" +
      'The Library is created on first publish if it does not exist yet.\n\nExamples: `{action: "get"}` · `{action: "publish", table_ids: [9, 12]}` · `{action: "unpublish", schema_ids: ["1:staging"]}`',
    parameters,
    execute: (_id, params) => runLibraryTool(deps, params),
  });
}

type LibraryParams = Static<typeof parameters>;

export function runLibraryTool(
  deps: MetabaseToolDeps,
  params: LibraryParams,
): Promise<TextToolResult> {
  return guardTool(async () => {
    assertCapabilities(deps.instance, LIBRARY_CAPABILITIES, TOOL_NAME);
    return await run(deps.client, params);
  });
}

async function run(client: Client, params: LibraryParams): Promise<TextToolResult> {
  switch (params.action) {
    case "get": {
      const library = await fetchLibrary(client);
      if (library === null) {
        throw new TeachingError(
          'This instance has no Library yet. It is created the first time you publish into it — `{action: "publish", table_ids: [...]}`.',
        );
      }
      return jsonResult(`library collection ${String(library.id)}`, LibraryCompact.parse(library));
    }
    case "publish": {
      const selectors = requireSelectors(params);
      const collectionId = await ensureLibraryDataCollectionId(client);
      const result = await client.requestParsed(PublishResult, PUBLISH_PATH, {
        method: "POST",
        body: { collection_id: collectionId, ...selectors },
      });
      const target = result.target_collection;
      const where = target === null ? "the Library" : `Library collection ${String(target.id)}`;
      return jsonResult(`published the selected tables, and their upstream sources, to ${where}`, {
        target_collection: target === null ? null : CollectionCompact.parse(target),
        ...selectors,
      });
    }
    case "unpublish": {
      const selectors = requireSelectors(params);
      await client.requestRaw(UNPUBLISH_PATH, {
        method: "POST",
        body: selectors,
        expectContentType: "binary",
      });
      return jsonResult(
        "unpublished the selected tables, and every table downstream of them, from the Library",
        { unpublished: true, ...selectors },
      );
    }
  }
}

interface TableSelectors {
  table_ids?: number[];
  database_ids?: number[];
  schema_ids?: string[];
}

function requireSelectors(params: LibraryParams): TableSelectors {
  const selectors: TableSelectors = {};
  if (params.table_ids !== undefined && params.table_ids.length > 0) {
    selectors.table_ids = params.table_ids;
  }
  if (params.database_ids !== undefined && params.database_ids.length > 0) {
    selectors.database_ids = params.database_ids;
  }
  if (params.schema_ids !== undefined && params.schema_ids.length > 0) {
    selectors.schema_ids = params.schema_ids;
  }
  if (Object.keys(selectors).length === 0) {
    throw new TeachingError(
      `\`${params.action}\` needs at least one selector: \`table_ids\`, \`database_ids\`, or \`schema_ids\`.`,
    );
  }
  return selectors;
}

// The Library root reports its children without their `type`, so Data and Metrics are
// indistinguishable in that payload alone; the collection list carries the type, and the id is the
// join. Without it there is no way to say which child a table publishes into.
async function fetchLibrary(client: Client): Promise<Library | null> {
  const result = await client.requestParsed(LibraryOrAbsent, LIBRARY_ROOT_PATH);
  if (!("effective_children" in result)) {
    return null;
  }
  const collections = await client.requestParsed(CollectionList, "/api/collection");
  const typeById = new Map(collections.map((collection) => [collection.id, collection.type]));
  const effective_children = result.effective_children.map((child) => ({
    ...child,
    type: typeById.get(child.id) ?? child.type,
  }));
  return { ...result, effective_children };
}

async function ensureLibraryDataCollectionId(client: Client): Promise<number> {
  const existing = await fetchLibrary(client);
  const library = existing ?? (await createLibrary(client));
  const data = library.effective_children.find(
    (child) => child.type === LIBRARY_DATA_TYPE && typeof child.id === "number",
  );
  if (data === undefined || typeof data.id !== "number") {
    throw new TeachingError(
      `The Library (collection ${String(library.id)}) has no Data collection to publish into. An admin has to repair it in the Metabase UI.`,
    );
  }
  return data.id;
}

async function createLibrary(client: Client): Promise<Library> {
  await client.requestRaw(LIBRARY_ROOT_PATH, { method: "POST", expectContentType: "binary" });
  const created = await fetchLibrary(client);
  if (created === null) {
    throw new TeachingError(
      "Metabase accepted the request to create the Library but then reported none. Only admins and data analysts may curate it — if you are neither, that is the reason.",
    );
  }
  return created;
}
