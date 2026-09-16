import { createServerProfile, type ServerProfile } from "@metabase/client/version/profile";

import { readProfileRecord } from "./storage";

// The server a profile last probed, derived at read time, or `null` when the record has no probe
// to derive it from. Nothing here reaches the network, so a caller that only needs to know what
// the server can do keeps working offline.
export async function readCachedServerProfile(profileName: string): Promise<ServerProfile | null> {
  const record = await readProfileRecord(profileName);
  if (record === null || record.lastProbe === null) {
    return null;
  }
  return createServerProfile(record.lastProbe);
}
