import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  Collection,
  CollectionCompact,
  CollectionCreateInput,
  CollectionUpdateInput,
} from "@metabase/cli/domain";
import { type Static, Type } from "typebox";
import type { MetabaseToolDeps } from "./deps";
import { entityResult, guardTool, type TextToolResult } from "./tool-result";
import { assertMethodRequirements, methodSchema } from "./write-recipe";

const parameters = Type.Object({
  method: methodSchema,
  id: Type.Optional(Type.Integer({ description: "Collection id. Required for `update`." })),
  name: Type.Optional(Type.String({ description: "Collection name. Required for `create`." })),
  description: Type.Optional(Type.String()),
  parent_id: Type.Optional(
    Type.Integer({
      description:
        "Collection this one sits inside. Omit for the root collection; set it to move the collection and everything under it.",
    }),
  ),
  archived: Type.Optional(
    Type.Boolean({
      description:
        "`update` only: `true` sends the collection and its contents to the trash, `false` restores them.",
    }),
  ),
});

export function collectionWriteTool(deps: MetabaseToolDeps): ToolDefinition {
  return defineTool({
    name: "collection_write",
    label: "Write collection",
    description:
      'Create or update a collection — the folder questions, dashboards, and other collections live in. `parent_id` nests it (omit for the root collection) and moving a collection moves everything inside it. `archived: true` trashes the collection with its contents; `archived: false` restores it.\n\nExamples: `{method: "create", name: "Q3 Reporting", parent_id: 4}` · `{method: "update", id: 12, name: "Finance", description: "Owned by the finance team"}` · `{method: "update", id: 12, archived: true}`',
    parameters,
    execute: (_id, params) => runCollectionWriteTool(deps, params),
  });
}

type CollectionWriteParams = Static<typeof parameters>;

export function runCollectionWriteTool(
  deps: MetabaseToolDeps,
  params: CollectionWriteParams,
): Promise<TextToolResult> {
  return guardTool(async () => {
    assertMethodRequirements(params.method, params, { create: ["name"], update: ["id"] });
    const fields = {
      name: params.name,
      description: params.description,
      parent_id: params.parent_id,
    };

    if (params.method === "create") {
      const created = await deps.client.requestParsed(Collection, "/api/collection", {
        method: "POST",
        body: CollectionCreateInput.parse(fields),
      });
      return entityResult(
        "collection",
        `created collection ${created.id}`,
        CollectionCompact.parse(created),
      );
    }

    const updated = await deps.client.requestParsed(
      Collection,
      `/api/collection/${String(params.id)}`,
      {
        method: "PUT",
        body: CollectionUpdateInput.parse({ ...fields, archived: params.archived }),
      },
    );
    return entityResult(
      "collection",
      `updated collection ${updated.id}`,
      CollectionCompact.parse(updated),
    );
  });
}
