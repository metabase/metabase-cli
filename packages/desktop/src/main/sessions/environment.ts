import type { SessionEnvironment } from "../../contracts/connection";
import type { MetabaseWorktree } from "../../contracts/metabase";
import type { Session } from "../../contracts/session";
import { cliEnvironment, type CliLocation } from "../cli/paths";
import type { MergedPath } from "../process/path";

export interface ProcessEnvironmentDeps {
  readonly env: NodeJS.ProcessEnv;
  readonly cli: CliLocation;
  readonly path: () => Promise<MergedPath>;
  readonly worktree: (session: Session) => Promise<MetabaseWorktree>;
}

// What every process a session starts sees, the agent and a terminal alike: the app's `mb` first
// on `PATH` and the broker's credential when there is a connection. The Metabase worktree is the
// broker's to name, never the environment's; it is settled before the process starts so the first
// `mb` call does not wait out the broker's timeout on it.
export async function sessionProcessEnvironment(
  deps: ProcessEnvironmentDeps,
  session: Session,
  broker: SessionEnvironment | null,
): Promise<NodeJS.ProcessEnv> {
  const merged = await deps.path();
  const brokerEnv =
    broker === null
      ? {}
      : {
          MB_URL: broker.MB_URL,
          MB_AUTH_BROKER: broker.MB_AUTH_BROKER,
          MB_AUTH_BROKER_TOKEN: broker.MB_AUTH_BROKER_TOKEN,
        };
  const cli = cliEnvironment(deps.cli, merged.value);
  await deps.worktree(session);
  return { ...deps.env, ...cli, ...brokerEnv };
}
