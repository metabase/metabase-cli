import { expect, test } from "vitest";
import type { InstanceContext } from "./metabase/probe";
import { UNKNOWN_INSTANCE } from "./metabase/probe";
import { buildSystemPrompt, SYSTEM_PROMPT_CORE } from "./prompt";

const PERMISSIONS_NOTE =
  "Every tool call runs against this instance, as this user. Their permissions are the boundary: a collection you cannot see does not exist for you, and a write the server rejects is an answer, not a bug to route around.";

const ENTERPRISE: InstanceContext = {
  url: "https://metabase.example.com/analytics",
  versionTag: "v1.58.4",
  majorVersion: 58,
  edition: "enterprise",
  tokenFeatures: ["remote_sync", "transforms"],
  user: {
    id: 7,
    email: "ada@example.com",
    common_name: "Ada Lovelace",
    is_superuser: true,
  },
};

test("renders a fully probed instance", () => {
  expect(buildSystemPrompt(ENTERPRISE)).toBe(
    `${SYSTEM_PROMPT_CORE}

## This instance

- URL: https://metabase.example.com/analytics
- Version: v1.58.4 (Metabase 58, Enterprise build)
- Paid features: remote_sync, transforms
- You are acting as: Ada Lovelace <ada@example.com>, user id 7 (admin)

${PERMISSIONS_NOTE}`,
  );
});

test("names an OSS instance's lack of paid features, and a non-admin acting user", () => {
  const oss: InstanceContext = {
    ...ENTERPRISE,
    versionTag: "v0.58.4",
    edition: "oss",
    tokenFeatures: [],
    user: { id: 12, email: "grace@example.com", common_name: "Grace Hopper", is_superuser: false },
  };

  expect(buildSystemPrompt(oss)).toBe(
    `${SYSTEM_PROMPT_CORE}

## This instance

- URL: https://metabase.example.com/analytics
- Version: v0.58.4 (Metabase 58, OSS build)
- Paid features: none — this instance has no paid features enabled
- You are acting as: Grace Hopper <grace@example.com>, user id 12 (non-admin)

${PERMISSIONS_NOTE}`,
  );
});

// The agent's capability is exactly its curated tools. A prompt that names the CLI hands the model a
// surface it cannot reach — and the two are separate products besides.
test("never points the model at the mb CLI", () => {
  expect(buildSystemPrompt(ENTERPRISE)).not.toMatch(/`mb\b/);
});

test("renders every unprobed fact as an explicit unknown rather than omitting it", () => {
  expect(buildSystemPrompt(UNKNOWN_INSTANCE)).toBe(
    `${SYSTEM_PROMPT_CORE}

## This instance

- URL: unknown
- Version: unknown
- Paid features: unknown
- You are acting as: unknown

${PERMISSIONS_NOTE}`,
  );
});
