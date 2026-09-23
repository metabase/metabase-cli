import type { ConnectionState } from "../contracts/connection";
import { assertNever } from "../contracts/assert-never";

// The sidebar's head says when the link to Metabase is broken, so a sign-out mid-session is visible
// from whichever panel is open. A working link says nothing.
export function connectionWarning(state: ConnectionState): string | null {
  switch (state.kind) {
    case "disconnected":
    case "connected": {
      return null;
    }
    case "stale": {
      return "Can't reach Metabase";
    }
    case "signed-out": {
      return "Signed out of Metabase";
    }
    default: {
      return assertNever(state);
    }
  }
}
