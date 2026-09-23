import type { ConnectionState, SessionEnvironment } from "../../contracts/connection";

import type { CredentialBroker } from "./broker";

export const NOT_CONNECTED_MESSAGE = "Connect to Metabase in Settings first.";

// A session that is not connected still runs; it just has no Metabase credential to hand the CLI,
// and the caller decides whether that is a refusal or a session without `mb`.
export function sessionEnvironment(
  broker: CredentialBroker,
  state: ConnectionState,
): SessionEnvironment | null {
  if (state.kind === "disconnected") {
    return null;
  }
  const session = broker.mintSession();
  return {
    sessionId: session.sessionId,
    MB_URL: state.url,
    MB_AUTH_BROKER: broker.url,
    MB_AUTH_BROKER_TOKEN: session.token,
  };
}
