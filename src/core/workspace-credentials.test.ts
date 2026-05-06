import { describe, expect, it } from "vitest";
import { z } from "zod";

import { parseYaml } from "../runtime/yaml";

import { ConfigError } from "./errors";
import {
  API_KEY_GROUP,
  API_KEY_NAME,
  buildCredentialsJson,
  generateWorkspaceCredentials,
  injectCredentialsIntoConfig,
} from "./workspace-credentials";

const OVERWRITE_REFUSAL =
  "config.yml already declares users or api-keys — refusing to overwrite parent-supplied credentials";

function captureThrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (caught) {
    return caught;
  }
  throw new Error("expected the callback to throw");
}

const PARENT_CONFIG_YAML = `version: 1
config:
  databases:
    - name: neondb
      engine: postgres
      details:
        host: example.com
        password: hunter2
        schema-filters-patterns: public
  workspace:
    name: my_ws
    databases:
      neondb:
        input_schemas:
          - public
        output_schema: mb_ws_2
`;

describe("generateWorkspaceCredentials", () => {
  it("produces the full deterministic + random shape; API key matches Metabase's bounded mb_<base64> format", () => {
    const credentials = generateWorkspaceCredentials(42);
    expect(credentials).toEqual({
      workspace_id: 42,
      user: {
        first_name: "Workspace",
        last_name: "Admin",
        password: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
        email: "workspace-42@workspace.local",
      },
      api_key: {
        name: API_KEY_NAME,
        group: API_KEY_GROUP,
        creator: "workspace-42@workspace.local",
        key: expect.stringMatching(/^mb_[A-Za-z0-9+/=]{8,251}$/),
      },
    });
  });

  it("generates fresh randomness on each call", () => {
    const a = generateWorkspaceCredentials(1);
    const b = generateWorkspaceCredentials(1);
    expect(a.user.password).not.toBe(b.user.password);
    expect(a.api_key.key).not.toBe(b.api_key.key);
  });
});

describe("buildCredentialsJson", () => {
  it("emits UTF-8 bytes that JSON.parse round-trips into the original credentials", () => {
    const credentials = generateWorkspaceCredentials(3);
    const bytes = buildCredentialsJson(credentials);
    const decoded = new TextDecoder().decode(bytes);
    expect(JSON.parse(decoded)).toEqual(credentials);
  });

  it("ends with a trailing newline", () => {
    const credentials = generateWorkspaceCredentials(1);
    const decoded = new TextDecoder().decode(buildCredentialsJson(credentials));
    expect(decoded.endsWith("\n")).toBe(true);
  });
});

describe("injectCredentialsIntoConfig", () => {
  it("adds users + api-keys under config: while preserving the parent fields", () => {
    const credentials = generateWorkspaceCredentials(2);
    const merged = injectCredentialsIntoConfig(PARENT_CONFIG_YAML, credentials);

    const parsed = parseYaml(merged, z.unknown());
    expect(parsed).toEqual({
      version: 1,
      config: {
        databases: [
          {
            name: "neondb",
            engine: "postgres",
            details: {
              host: "example.com",
              password: "hunter2",
              "schema-filters-patterns": "public",
            },
          },
        ],
        workspace: {
          name: "my_ws",
          databases: {
            neondb: { input_schemas: ["public"], output_schema: "mb_ws_2" },
          },
        },
        users: [credentials.user],
        "api-keys": [credentials.api_key],
      },
    });
  });

  const PARENT_CONFIG_WITH_USERS = `${PARENT_CONFIG_YAML}  users:
    - email: existing@example.com
`;

  const PARENT_CONFIG_WITH_API_KEYS = `${PARENT_CONFIG_YAML}  api-keys:
    - name: existing
      key: mb_x
      group: admin
      creator: someone@example.com
`;

  it.each<[string, string]>([
    ["users", PARENT_CONFIG_WITH_USERS],
    ["api-keys", PARENT_CONFIG_WITH_API_KEYS],
  ])("refuses to overwrite a config that already declares %s", (_label, yaml) => {
    const credentials = generateWorkspaceCredentials(1);
    const thrown = captureThrown(() => injectCredentialsIntoConfig(yaml, credentials));
    expect(thrown).toBeInstanceOf(ConfigError);
    if (!(thrown instanceof ConfigError)) {
      throw new Error("expected ConfigError");
    }
    expect(thrown.message).toBe(OVERWRITE_REFUSAL);
  });
});
