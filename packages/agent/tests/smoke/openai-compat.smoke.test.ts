import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { RequestOptions } from "@metabase/cli/client";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { type AgentModel, resolveAgentModel } from "../../src/models";
import { createMetabaseAgentSession } from "../../src/session";
import { fakeClient, type RecordedRequest } from "../../src/tools/fake-client";

const CARD_ID = 7;
const DASHBOARD_ID = 9;
const HEADING = "Smoke heading";
const FILTER_NAME = "Row limit";
const FILTER_ID = "row_limit";
const ACME_KEY_ENV = "ACME_API_KEY";
const ACME_KEY = "acme-secret";
const ZAI_KEY = "zai-secret";
const REPLY = "Created the dashboard.";

// The layout document is the hardest argument payload the harness sends inline: nested arrays of
// heterogeneous entries, one of them mapping a parameter another entry declares. Every provider
// check drives this exact call, so argument truncation or flattening on the wire fails the smoke
// rather than surfacing later as a mangled dashboard.
const DASHBOARD_WRITE_ARGS = {
  method: "create",
  name: "Smoke dashboard",
  layout: {
    parameters: [{ id: FILTER_ID, name: FILTER_NAME, type: "number" }],
    dashcards: [
      { heading: HEADING },
      {
        card_id: CARD_ID,
        parameter_mappings: [{ parameter_id: FILTER_ID, target_tag: FILTER_ID }],
      },
    ],
  },
};

interface ScriptedTurn {
  toolName?: string;
  toolArgs?: unknown;
  text?: string;
}

const SCRIPT: readonly ScriptedTurn[] = [
  { toolName: "dashboard_write", toolArgs: DASHBOARD_WRITE_ARGS },
  { text: REPLY },
];

interface ModelRequest {
  authorization: string | undefined;
  body: ChatRequest;
}

const ToolSpec = z
  .object({ function: z.object({ name: z.string(), parameters: z.unknown() }).loose() })
  .loose();
const ChatRequest = z.object({ model: z.string(), tools: z.array(ToolSpec).optional() }).loose();
type ChatRequest = z.infer<typeof ChatRequest>;

const modelRequests: ModelRequest[] = [];
let server: Server;
let baseUrl: string;
let modelsJsonPath: string;
let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "mb-agent-compat-"));
  server = await startModelServer();
  baseUrl = `http://127.0.0.1:${port(server)}/v1`;
  modelsJsonPath = join(tempDir, "models.json");
  await writeFile(modelsJsonPath, JSON.stringify(modelsJson(baseUrl)), "utf8");
  process.env[ACME_KEY_ENV] = ACME_KEY;
});

afterAll(async () => {
  delete process.env[ACME_KEY_ENV];
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(tempDir, { recursive: true, force: true });
});

afterEach(() => {
  modelRequests.length = 0;
});

test("carries the runtime key and the curated tool schemas to a built-in provider's endpoint", async () => {
  const model = resolveAgentModel({
    env: {
      AGENT_MODEL: "zai/glm-5.1",
      ZAI_API_KEY: ZAI_KEY,
      AGENT_MODELS_JSON: modelsJsonPath,
    },
  });

  const requests = await runScripted(model);

  expect(modelRequests.map((request) => request.authorization)).toEqual([
    `Bearer ${ZAI_KEY}`,
    `Bearer ${ZAI_KEY}`,
  ]);
  expect(layoutSchemaType()).toBe("object");
  expect(writtenLayout(requests)).toEqual({
    dashcards: [
      { card_id: null, parameter_mappings: [] },
      { card_id: CARD_ID, parameter_mappings: [FILTER_ID] },
    ],
    parameters: [{ id: FILTER_ID, name: FILTER_NAME, type: "number" }],
  });
});

test("runs the same session against a models.json OpenAI-compatible endpoint", async () => {
  const model = resolveAgentModel({
    env: { AGENT_MODEL: "acme/acme-1", AGENT_MODELS_JSON: modelsJsonPath },
  });
  expect(model.apiKey).toBe(null);

  const requests = await runScripted(model);

  expect(modelRequests.map((request) => request.authorization)).toEqual([
    `Bearer ${ACME_KEY}`,
    `Bearer ${ACME_KEY}`,
  ]);
  expect(modelRequests.map((request) => request.body.model)).toEqual(["acme-1", "acme-1"]);
  expect(writtenLayout(requests)).toEqual({
    dashcards: [
      { card_id: null, parameter_mappings: [] },
      { card_id: CARD_ID, parameter_mappings: [FILTER_ID] },
    ],
    parameters: [{ id: FILTER_ID, name: FILTER_NAME, type: "number" }],
  });
});

async function runScripted(model: AgentModel): Promise<RecordedRequest[]> {
  const cwd = await mkdtemp(join(tmpdir(), "mb-agent-compat-cwd-"));
  const { client, requests } = fakeClient(metabaseResponder);
  const session: AgentSession = await createMetabaseAgentSession({
    cwd,
    model,
    client,
  });
  try {
    await session.prompt("Build the smoke dashboard.");
    expect(session.agent.state.errorMessage).toBeUndefined();
    return requests;
  } finally {
    session.dispose();
    await rm(cwd, { recursive: true, force: true });
  }
}

const WrittenLayout = z
  .object({
    dashcards: z.array(
      z
        .object({
          card_id: z.number().int().nullable(),
          parameter_mappings: z.array(z.object({ parameter_id: z.string() }).loose()),
        })
        .loose(),
    ),
    parameters: z.array(z.object({ id: z.string(), name: z.string(), type: z.string() }).loose()),
  })
  .loose();

interface CompiledLayout {
  dashcards: CompiledDashcard[];
  parameters: CompiledParameter[];
}

interface CompiledDashcard {
  card_id: number | null;
  parameter_mappings: string[];
}

interface CompiledParameter {
  id: string;
  name: string;
  type: string;
}

// What the tool compiled out of the layout document and PUT back to Metabase — the end of the
// wire the document travelled down.
function writtenLayout(requests: readonly RecordedRequest[]): CompiledLayout {
  const put = requests.find(
    (request) => request.method === "PUT" && request.path === `/api/dashboard/${DASHBOARD_ID}`,
  );
  if (put === undefined) {
    throw new Error("The dashboard was never written.");
  }
  const layout = WrittenLayout.parse(put.options?.body);
  return {
    dashcards: layout.dashcards.map((dashcard) => ({
      card_id: dashcard.card_id,
      parameter_mappings: dashcard.parameter_mappings.map((mapping) => mapping.parameter_id),
    })),
    parameters: layout.parameters.map((parameter) => ({
      id: parameter.id,
      name: parameter.name,
      type: parameter.type,
    })),
  };
}

const LayoutSchema = z
  .object({ properties: z.object({ layout: z.object({ type: z.string() }).loose() }).loose() })
  .loose();

// The layout param must reach the provider as an object schema — a compat layer that drops or
// stringifies nested tool parameters shows up here before it shows up as a mangled tool call.
function layoutSchemaType(): string {
  const tools = modelRequests[0]?.body.tools;
  if (tools === undefined) {
    throw new Error("The model was offered no tools.");
  }
  const dashboardWrite = tools.find((tool) => tool.function.name === "dashboard_write");
  if (dashboardWrite === undefined) {
    throw new Error("dashboard_write was not offered to the model.");
  }
  return LayoutSchema.parse(dashboardWrite.function.parameters).properties.layout.type;
}

function metabaseResponder(path: string, options: RequestOptions | undefined): unknown {
  if (path === `/api/card/${CARD_ID}`) {
    return card();
  }
  if (path === "/api/dashboard" && options?.method === "POST") {
    return dashboard();
  }
  if (path === `/api/dashboard/${DASHBOARD_ID}` && options?.method === "PUT") {
    return { ...dashboard(), ...WrittenLayout.parse(options.body) };
  }
  throw new Error(`The scripted session did not expect ${options?.method ?? "GET"} ${path}.`);
}

interface DashboardFixture {
  id: number;
  name: string;
  description: string | null;
  archived: boolean;
  collection_id: number | null;
  creator_id: number;
  entity_id: string;
  width: string;
  auto_apply_filters: boolean;
  enable_embedding: boolean;
  public_uuid: string | null;
  cache_ttl: number | null;
  parameters: unknown[];
  dashcards: unknown[];
  tabs: unknown[];
}

function dashboard(): DashboardFixture {
  return {
    id: DASHBOARD_ID,
    name: "Smoke dashboard",
    description: null,
    archived: false,
    collection_id: null,
    creator_id: 1,
    entity_id: "dashboard-entity",
    width: "fixed",
    auto_apply_filters: true,
    enable_embedding: false,
    public_uuid: null,
    cache_ttl: null,
    parameters: [],
    dashcards: [],
    tabs: [],
  };
}

function card(): unknown {
  return {
    id: CARD_ID,
    name: "Smoke rows",
    type: "question",
    display: "table",
    description: null,
    archived: false,
    query_type: "native",
    database_id: 1,
    table_id: 2,
    collection_id: null,
    entity_id: "card-entity",
    creator_id: 1,
    visualization_settings: {},
    dataset_query: {
      "lib/type": "mbql/query",
      database: 1,
      stages: [
        {
          "lib/type": "mbql.stage/native",
          native: `SELECT * FROM orders LIMIT {{${FILTER_ID}}}`,
          "template-tags": { [FILTER_ID]: { type: "number", name: FILTER_ID } },
        },
      ],
    },
  };
}

function modelsJson(url: string): unknown {
  return {
    providers: {
      zai: { baseUrl: url },
      acme: {
        baseUrl: url,
        api: "openai-completions",
        apiKey: `$${ACME_KEY_ENV}`,
        models: [
          {
            id: "acme-1",
            name: "Acme 1",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128_000,
            maxTokens: 4096,
          },
        ],
      },
    },
  };
}

function port(listening: Server): number {
  const address = listening.address();
  if (address === null || typeof address === "string") {
    throw new Error("The scripted model server did not bind a TCP port.");
  }
  return address.port;
}

async function startModelServer(): Promise<Server> {
  const listening = createServer((request, response) => {
    void handleChat(request, response);
  });
  await new Promise<void>((resolve) => listening.listen(0, "127.0.0.1", resolve));
  return listening;
}

async function handleChat(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  const body = ChatRequest.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  const turn = SCRIPT[modelRequests.length];
  modelRequests.push({ authorization: request.headers.authorization, body });
  if (turn === undefined) {
    response.writeHead(500).end("The script ran out of turns.");
    return;
  }

  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  for (const chunk of streamChunks(turn, body.model)) {
    response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }
  response.write("data: [DONE]\n\n");
  response.end();
}

function streamChunks(turn: ScriptedTurn, model: string): unknown[] {
  const envelope = { id: "smoke", object: "chat.completion.chunk", created: 0, model };
  const usage = {
    ...envelope,
    choices: [],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };

  if (turn.toolName !== undefined) {
    const call = {
      index: 0,
      id: `call_${turn.toolName}`,
      type: "function",
      function: { name: turn.toolName, arguments: JSON.stringify(turn.toolArgs) },
    };
    return [
      {
        ...envelope,
        choices: [
          { index: 0, delta: { role: "assistant", tool_calls: [call] }, finish_reason: null },
        ],
      },
      { ...envelope, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
      usage,
    ];
  }

  return [
    {
      ...envelope,
      choices: [
        { index: 0, delta: { role: "assistant", content: turn.text }, finish_reason: null },
      ],
    },
    { ...envelope, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    usage,
  ];
}
