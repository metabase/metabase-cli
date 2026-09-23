import type { SessionEnvironment } from "../../contracts/connection";
import type { Session } from "../../contracts/session";
import { cliEnvironment, type CliLocation } from "../cli/paths";
import type { MergedPath } from "../process/path";

export interface ProcessEnvironmentDeps {
  readonly env: NodeJS.ProcessEnv;
  readonly cli: CliLocation;
  readonly path: () => Promise<MergedPath>;
  readonly worktreeEnvironment: (session: Session) => Promise<NodeJS.ProcessEnv>;
}

// What every process a session starts sees, the agent and a terminal alike: the app's `mb` first
// on `PATH`, the broker's credential when there is a connection, and the Metabase worktree the
// session syncs to.
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
  const worktreeEnv = await deps.worktreeEnvironment(session);
  return { ...deps.env, ...cli, ...brokerEnv, ...worktreeEnv };
}
