import { SessionProperties } from "../domain/session-properties";
import type { ProbeReadOptions, Transport } from "../http/transport";

export function sessionResource(transport: Transport) {
  /**
   * Get the session properties: the settings the caller may read, among them the server's version
   * and the premium features its license grants. Read afresh, never from a profile handed in.
   */
  async function properties(options: ProbeReadOptions = {}): Promise<SessionProperties> {
    return transport.probe(SessionProperties, options);
  }

  return { properties };
}
