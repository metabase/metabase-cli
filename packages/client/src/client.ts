import { type ClientCredentials, type ClientOptions, createTransport } from "./http/transport";
import { cardResource } from "./resources/card";
import { collectionResource } from "./resources/collection";
import { dashboardResource } from "./resources/dashboard";
import { databaseResource } from "./resources/database";
import { datasetResource } from "./resources/dataset";
import { documentResource } from "./resources/document";
import { eidTranslationResource } from "./resources/eid-translation";
import { fieldResource } from "./resources/field";
import { gitSyncResource } from "./resources/git-sync";
import { libraryResource } from "./resources/library";
import { measureResource } from "./resources/measure";
import { notificationResource } from "./resources/notification";
import { pulseResource } from "./resources/pulse";
import { searchResource } from "./resources/search";
import { segmentResource } from "./resources/segment";
import { settingResource } from "./resources/setting";
import { setupResource } from "./resources/setup";
import { snippetResource } from "./resources/snippet";
import { tableResource } from "./resources/table";
import { timelineEventResource } from "./resources/timeline-event";
import { timelineResource } from "./resources/timeline";
import { transformJobResource } from "./resources/transform-job";
import { transformResource } from "./resources/transform";
import { transformTagResource } from "./resources/transform-tag";
import { transformTestResource } from "./resources/transform-test";
import { uploadResource } from "./resources/upload";
import { userResource } from "./resources/user";

// The return type is left for inference on purpose: `MetabaseClient` is `ReturnType<typeof
// createClient>`, so any annotation here would freeze the client at what that annotation names and
// the resource namespaces composed onto it would be invisible to every consumer.
export function createClient(config: ClientCredentials, options: ClientOptions) {
  const transport = createTransport(config, options);
  return {
    card: cardResource(transport),
    collection: collectionResource(transport),
    dashboard: dashboardResource(transport),
    database: databaseResource(transport),
    dataset: datasetResource(transport),
    document: documentResource(transport),
    eidTranslation: eidTranslationResource(transport),
    field: fieldResource(transport),
    gitSync: gitSyncResource(transport),
    library: libraryResource(transport),
    measure: measureResource(transport),
    notification: notificationResource(transport),
    pulse: pulseResource(transport),
    search: searchResource(transport),
    segment: segmentResource(transport),
    setting: settingResource(transport),
    setup: setupResource(transport),
    snippet: snippetResource(transport),
    table: tableResource(transport),
    timeline: timelineResource(transport),
    timelineEvent: timelineEventResource(transport),
    transform: transformResource(transport),
    transformJob: transformJobResource(transport),
    transformTag: transformTagResource(transport),
    transformTest: transformTestResource(transport),
    upload: uploadResource(transport),
    user: userResource(transport),
    // The escape hatch: an endpoint the client never models still has to cost a consumer nothing.
    requestParsed: transport.requestParsed,
    requestRaw: transport.requestRaw,
    requestStream: transport.requestStream,
  };
}

export type MetabaseClient = ReturnType<typeof createClient>;
