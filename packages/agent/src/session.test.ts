import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { Client } from "@metabase/cli/client";
import { Type } from "typebox";
import { afterEach, expect, test } from "vitest";
import type { InstanceContext } from "./metabase/probe";
import type { AgentModel } from "./models";
import { createMetabaseAgentRuntime, createMetabaseAgentSession } from "./session";
import { metabaseSkillPaths } from "./skills";

const unusedClient: Client = {
  requestParsed: () => Promise.reject(new Error("not called")),
  requestRaw: () => Promise.reject(new Error("not called")),
  requestStream: () => Promise.reject(new Error("not called")),
};

const SESSION_TOOLS = [
  "bash",
  "browse_collection",
  "browse_data",
  "collection_write",
  "dashboard_write",
  "document_write",
  "duplicate_content",
  "edit",
  "execute_query",
  "execute_sql",
  "find",
  "get_content",
  "get_parameter_values",
  "git_sync",
  "grep",
  "instance_settings",
  "library",
  "ls",
  "measure_write",
  "metadata_write",
  "question_write",
  "read",
  "run_saved_question",
  "search",
  "segment_write",
  "snippet_write",
  "timeline_write",
  "transform_job_write",
  "transform_run",
  "transform_write",
  "upload_csv",
  "write",
];

const scratchDirs: string[] = [];
const originalPath = process.env["PATH"];

afterEach(async () => {
  process.env["PATH"] = originalPath;
  for (const dir of scratchDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  scratchDirs.length = 0;
});

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mb-agent-test-"));
  scratchDirs.push(dir);
  return dir;
}

// The curated tools are the agent's whole Metabase surface. Building a session must not hand the
// model a CLI in bash: `mb` is a separate product, authenticated against a store this one does not
// own, and a model that can shell out to it stops reaching for the tools.
test("leaves the PATH pi's bash inherits untouched", async () => {
  const cwd = await scratch();
  const foreign = await scratch();
  process.env["PATH"] = `${foreign}${delimiter}${originalPath ?? ""}`;
  const before = process.env["PATH"];

  const session = await createMetabaseAgentSession({ cwd, client: unusedClient });
  try {
    expect(process.env["PATH"]).toBe(before);
  } finally {
    session.dispose();
  }
});

test("wires the curated Metabase tools alongside the coding builtins when a client is provided", async () => {
  const cwd = await scratch();
  const session = await createMetabaseAgentSession({
    cwd,
    client: unusedClient,
  });
  try {
    const toolNames = session.agent.state.tools.map((tool) => tool.name).toSorted();
    expect(toolNames).toEqual(SESSION_TOOLS);
  } finally {
    session.dispose();
  }
});

test("exposes only the coding builtins when no client is provided", async () => {
  const cwd = await scratch();
  const session = await createMetabaseAgentSession({ cwd });
  try {
    const toolNames = session.agent.state.tools.map((tool) => tool.name).toSorted();
    expect(toolNames).toEqual(["bash", "edit", "find", "grep", "ls", "read", "write"]);
  } finally {
    session.dispose();
  }
});

test("lists every Metabase skill in the model's system prompt, with a path it can read", async () => {
  const cwd = await scratch();
  const session = await createMetabaseAgentSession({ cwd });
  try {
    const prompt = session.agent.state.systemPrompt;
    const listed = [...prompt.matchAll(/<name>([^<]+)<\/name>/g)].map((match) => match[1]);
    expect(listed.toSorted()).toEqual([
      "core",
      "dashboard",
      "data-workflow",
      "document",
      "git-sync",
      "library",
      "mbql",
      "metadata",
      "native-sql",
      "transform",
      "visualization",
    ]);

    const mbql = metabaseSkillPaths().find((dir) => dir.endsWith("mbql"));
    expect(mbql).toBeDefined();
    expect(prompt).toContain(`<location>${join(mbql ?? "", "SKILL.md")}</location>`);
  } finally {
    session.dispose();
  }
});

test("builds a byte-identical prompt for two sessions against the same instance", async () => {
  const instance: InstanceContext = {
    url: "https://metabase.example.com",
    versionTag: "v1.58.4",
    majorVersion: 58,
    edition: "enterprise",
    tokenFeatures: ["transforms"],
    user: { id: 1, email: "ada@example.com", common_name: "Ada Lovelace", is_superuser: true },
  };
  const cwd = await scratch();
  const first = await createMetabaseAgentSession({ cwd, instance });
  const second = await createMetabaseAgentSession({ cwd, instance });
  try {
    expect(first.agent.state.systemPrompt).toBe(second.agent.state.systemPrompt);
    expect(first.agent.state.systemPrompt).toContain(
      "- Version: v1.58.4 (Metabase 58, Enterprise build)",
    );
  } finally {
    first.dispose();
    second.dispose();
  }
});

test("applies the system prompt override", async () => {
  const cwd = await scratch();
  const marker = "METABASE_AGENT_PROMPT_SENTINEL";
  const session = await createMetabaseAgentSession({
    cwd,
    systemPrompt: marker,
  });
  try {
    expect(session.agent.state.systemPrompt).toContain(marker);
  } finally {
    session.dispose();
  }
});

test("the runtime hands pi the same session the one-shot path builds, plus its services", async () => {
  const cwd = await scratch();
  const host = await createMetabaseAgentRuntime({ cwd, client: unusedClient });
  try {
    const toolNames = host.session.agent.state.tools.map((tool) => tool.name).toSorted();
    expect(toolNames).toEqual(SESSION_TOOLS);
    expect(host.services.settingsManager.getEnableInstallTelemetry()).toBe(false);
    expect(host.services.settingsManager.getEnableAnalytics()).toBe(false);
  } finally {
    await host.dispose();
  }
});

test("rebuilds the curated toolset when pi replaces the session", async () => {
  const cwd = await scratch();
  const host = await createMetabaseAgentRuntime({ cwd, client: unusedClient });
  try {
    const first = host.session;
    const { cancelled } = await host.newSession();

    expect(cancelled).toBe(false);
    expect(host.session).not.toBe(first);
    const toolNames = host.session.agent.state.tools.map((tool) => tool.name).toSorted();
    expect(toolNames).toEqual(SESSION_TOOLS);
  } finally {
    await host.dispose();
  }
});

test("keeps the model's key and pi's own state out of the agent directory", async () => {
  const cwd = await scratch();
  const agentDir = await scratch();
  const model: AgentModel = {
    spec: "anthropic/claude-sonnet-4-5",
    provider: "anthropic",
    thinkingLevel: null,
    apiKey: "runtime-key-never-written",
    modelsJsonPath: null,
  };
  const host = await createMetabaseAgentRuntime({ cwd, agentDir, model });
  try {
    await expect(host.services.authStorage.getApiKey("anthropic")).resolves.toBe(model.apiKey);
    expect(await readdir(agentDir)).toEqual([]);
  } finally {
    await host.dispose();
  }
});

test("explicit customTools override the curated Metabase tools", async () => {
  const cwd = await scratch();
  const probe = defineTool({
    name: "probe",
    label: "Probe",
    description: "Test tool.",
    parameters: Type.Object({}),
    execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
  });
  const session = await createMetabaseAgentSession({
    cwd,
    client: unusedClient,
    customTools: [probe],
  });
  try {
    const toolNames = session.agent.state.tools.map((tool) => tool.name);
    expect(toolNames).toContain("probe");
    expect(toolNames).not.toContain("search");
  } finally {
    session.dispose();
  }
});
