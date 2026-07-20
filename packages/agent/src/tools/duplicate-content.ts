import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Client } from "@metabase/cli/client";
import {
  Card,
  CardCompact,
  CardUpdateInput,
  Dashboard,
  DashboardCompact,
} from "@metabase/cli/domain";
import { HttpError } from "@metabase/cli/errors";
import { type Static, Type } from "typebox";
import type { MetabaseToolDeps } from "./deps";
import { TeachingError } from "./teaching-error";
import { entityResult, guardTool, type TextToolResult } from "./tool-result";

const DUPLICATE_TYPES = ["question", "dashboard"] as const;
type DuplicateType = (typeof DUPLICATE_TYPES)[number];

const SHALLOW_COPY_MARKER = "shallow copy";

const parameters = Type.Object({
  type: Type.Unsafe<DuplicateType>({
    type: "string",
    enum: [...DUPLICATE_TYPES],
    description: "What to copy. `question` covers questions, models, and metrics.",
  }),
  id: Type.Integer({ description: "Id of the entity to copy." }),
  collection_id: Type.Optional(
    Type.Integer({ description: "Collection the copy lands in. Omit to keep the original's." }),
  ),
  new_name: Type.Optional(
    Type.String({ description: 'Name for the copy. Defaults to "Copy of <original>".' }),
  ),
  is_deep_copy: Type.Optional(
    Type.Boolean({
      description:
        "Dashboards only: also copy the questions on the dashboard, so edits to the copy leave the originals alone. A dashboard that holds questions saved inside it cannot be copied shallowly.",
    }),
  ),
});

export function duplicateContentTool(deps: MetabaseToolDeps): ToolDefinition {
  return defineTool({
    name: "duplicate_content",
    label: "Duplicate content",
    description:
      'Copy a question or a dashboard — the way to iterate on someone else\'s work without touching the original. Copying is one call; reading an entity and recreating it is not the same thing and gets details wrong.\n\nExamples: `{type: "question", id: 42, new_name: "Revenue — draft"}` · `{type: "dashboard", id: 3, collection_id: 7, is_deep_copy: true}`',
    parameters,
    execute: (_id, params) => runDuplicateContentTool(deps, params),
  });
}

type DuplicateContentParams = Static<typeof parameters>;

export function runDuplicateContentTool(
  deps: MetabaseToolDeps,
  params: DuplicateContentParams,
): Promise<TextToolResult> {
  return guardTool(async () => {
    if (params.type === "question") {
      if (params.is_deep_copy !== undefined) {
        throw new TeachingError(
          "`is_deep_copy` applies to dashboards — a question copy is always a new, independent card.",
        );
      }
      const copy = await copyCard(deps.client, params);
      return entityResult("question", `duplicated question ${copy.id}`, CardCompact.parse(copy));
    }
    const copy = await copyDashboard(deps.client, params);
    return entityResult(
      "dashboard",
      `duplicated dashboard ${copy.id}`,
      DashboardCompact.parse(copy),
    );
  });
}

// POST /api/card/:id/copy takes no body — it always names the copy "Copy of <name>" and leaves it
// in the source collection, so a rename or a move is a follow-up PUT.
async function copyCard(client: Client, params: DuplicateContentParams): Promise<Card> {
  const copy = await client.requestParsed(Card, `/api/card/${params.id}/copy`, { method: "POST" });
  if (params.new_name === undefined && params.collection_id === undefined) {
    return copy;
  }
  const body = CardUpdateInput.parse({
    name: params.new_name,
    collection_id: params.collection_id,
  });
  return client.requestParsed(Card, `/api/card/${copy.id}`, { method: "PUT", body });
}

async function copyDashboard(client: Client, params: DuplicateContentParams): Promise<Dashboard> {
  const body = {
    name: params.new_name,
    collection_id: params.collection_id,
    is_deep_copy: params.is_deep_copy ?? false,
  };
  try {
    return await client.requestParsed(Dashboard, `/api/dashboard/${params.id}/copy`, {
      method: "POST",
      body,
    });
  } catch (error) {
    throw explainShallowCopy(error);
  }
}

// The copy endpoint answers this one with a plain-text body, so the refusal never reaches
// `HttpError`'s message — it has to be read off the response itself.
function explainShallowCopy(error: unknown): unknown {
  if (!(error instanceof HttpError)) {
    return error;
  }
  const body = error.developerDetail.body ?? "";
  const refusal = [error.message, body].find((text) => text.includes(SHALLOW_COPY_MARKER));
  if (refusal === undefined) {
    return error;
  }
  return new TeachingError(
    `${refusal.trim()} Pass \`is_deep_copy: true\` to copy those questions along with the dashboard.`,
  );
}
