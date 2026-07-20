import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@metabase/cli/client";
import { afterEach, expect, test } from "vitest";
import { MetabaseAccess } from "../metabase/access";
import type { MetabaseConnection } from "../metabase/connection";
import type { InstanceContext } from "../metabase/probe";
import { createMetabaseAgentRuntime } from "../session";
import { metabaseLoginExtension } from "./login-command";

const scratchDirs: string[] = [];

afterEach(async () => {
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

const URL = "https://metabase.example.com";

const INSTANCE: InstanceContext = {
  url: URL,
  versionTag: "v1.63.0",
  majorVersion: 63,
  edition: "enterprise",
  tokenFeatures: ["transforms"],
  user: { id: 1, email: "ada@example.com", common_name: "Ada Lovelace", is_superuser: true },
};

function connection(): MetabaseConnection {
  return {
    client: createClient({ url: URL, credential: { kind: "apiKey", apiKey: "mb_key" } }),
    url: URL,
    profile: "default",
  };
}

test("offers /mb-login to a session that has no Metabase credential", async () => {
  const access = new MetabaseAccess(null);
  const host = await createMetabaseAgentRuntime({
    cwd: await scratch(),
    client: access.client,
    instance: () => access.instance(),
    extensions: [metabaseLoginExtension({ access, profile: "default" })],
  });
  try {
    const commands = host.session.extensionRunner
      .getRegisteredCommands()
      .map((command) => command.name);

    expect(commands).toEqual(["mb-login"]);
    expect(host.session.agent.state.systemPrompt).toContain("- Version: unknown");
  } finally {
    await host.dispose();
  }
});

test("describes the instance a login established once pi rebuilds the session", async () => {
  const access = new MetabaseAccess(null);
  const host = await createMetabaseAgentRuntime({
    cwd: await scratch(),
    client: access.client,
    instance: () => access.instance(),
    extensions: [metabaseLoginExtension({ access, profile: "default" })],
  });
  try {
    access.adopt(connection(), INSTANCE);
    const { cancelled } = await host.newSession();

    expect(cancelled).toBe(false);
    expect(host.session.agent.state.systemPrompt).toContain(
      "- Version: v1.63.0 (Metabase 63, Enterprise build)",
    );
    expect(host.session.agent.state.systemPrompt).toContain(URL);
  } finally {
    await host.dispose();
  }
});
