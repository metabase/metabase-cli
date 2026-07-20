import type { Client } from "@metabase/cli/client";
import type { InstanceContext } from "../metabase/probe";

export interface MetabaseToolDeps {
  client: Client;
  cwd: string;
  instance: InstanceContext;
}
