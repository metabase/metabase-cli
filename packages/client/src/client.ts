import { type ClientCredentials, type ClientOptions, createTransport } from "./http/transport";
import { databaseResource } from "./resources/database";
import { fieldResource } from "./resources/field";
import { gitSyncResource } from "./resources/git-sync";
import { userResource } from "./resources/user";

// The return type is left for inference on purpose: `MetabaseClient` is `ReturnType<typeof
// createClient>`, so any annotation here would freeze the client at what that annotation names and
// the resource namespaces composed onto it would be invisible to every consumer.
export function createClient(config: ClientCredentials, options: ClientOptions) {
  const transport = createTransport(config, options);
  return {
    database: databaseResource(transport),
    field: fieldResource(transport),
    gitSync: gitSyncResource(transport),
    user: userResource(transport),
    server: transport.server,
    // The escape hatch: an endpoint the client never models still has to cost a consumer nothing.
    requestParsed: transport.requestParsed,
    requestRaw: transport.requestRaw,
    requestStream: transport.requestStream,
  };
}

export type MetabaseClient = ReturnType<typeof createClient>;
