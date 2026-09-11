import type { TokenFeatures } from "@metabase/client/domain/session-properties";

import { writeProbeResult, writeProfile } from "../../packages/cli/src/core/auth/storage";
import { withConfigHomeEnv } from "./config-home-env";

// A profile the CLI can resolve but never reach, so a suite proves a command stopped before the
// network (a preflight refusal) or reached it (a connection error) without a server.
const UNREACHABLE_URL = "http://127.0.0.1:1";

export async function seedProfile(configHome: string): Promise<void> {
  await withConfigHomeEnv(configHome, async () => {
    await writeProfile({ url: UNREACHABLE_URL, apiKey: "secret-key" }, "default");
  });
}

export interface ProbedServer {
  major: number;
  tokenFeatures: TokenFeatures | null;
}

export async function seedProbedProfile(configHome: string, server: ProbedServer): Promise<void> {
  await seedProfile(configHome);
  await withConfigHomeEnv(configHome, async () => {
    await writeProbeResult("default", {
      user: { id: 1, name: "Tester", isAdmin: true },
      server: {
        version: { tag: `v0.${server.major}.0`, major: server.major, patch: 0 },
        tokenFeatures: server.tokenFeatures,
      },
    });
  });
}
