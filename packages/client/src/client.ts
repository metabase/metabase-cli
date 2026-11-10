import {
  type ClientCredentials,
  type ClientOptions,
  createTransport,
  type DerivedClientOptions,
  type ErrorObserver,
  type Transport,
} from "./http/transport";
import { apiKeyResource } from "./resources/api-key";
import { cardResource } from "./resources/card";
import { collectionResource } from "./resources/collection";
import { contentTranslationResource } from "./resources/content-translation";
import { dashboardResource } from "./resources/dashboard";
import { dataActionResource } from "./resources/data-action";
import { dataAppResource } from "./resources/data-app";
import { databaseResource } from "./resources/database";
import { datasetResource } from "./resources/dataset";
import { dependencyResource } from "./resources/dependency";
import { documentResource } from "./resources/document";
import { eidTranslationResource } from "./resources/eid-translation";
import { erdResource } from "./resources/erd";
import { fieldResource } from "./resources/field";
import { gitSyncResource } from "./resources/git-sync";
import { glossaryResource } from "./resources/glossary";
import { healthResource } from "./resources/health";
import { libraryResource } from "./resources/library";
import { measureResource } from "./resources/measure";
import { metricResource } from "./resources/metric";
import { moderationReviewResource } from "./resources/moderation-review";
import { notificationResource } from "./resources/notification";
import { permissionResource } from "./resources/permission";
import { pulseResource } from "./resources/pulse";
import { replacementResource } from "./resources/replacement";
import { revisionResource } from "./resources/revision";
import { searchResource } from "./resources/search";
import { segmentResource } from "./resources/segment";
import { sessionResource } from "./resources/session";
import { settingResource } from "./resources/setting";
import { setupResource } from "./resources/setup";
import { snippetResource } from "./resources/snippet";
import { tableResource } from "./resources/table";
import { taskResource } from "./resources/task";
import { timelineEventResource } from "./resources/timeline-event";
import { timelineResource } from "./resources/timeline";
import { transformDagRunResource } from "./resources/transform-dag-run";
import { transformInspectorResource } from "./resources/transform-inspector";
import { transformJobResource } from "./resources/transform-job";
import { transformPythonResource } from "./resources/transform-python";
import { transformResource } from "./resources/transform";
import { transformTagResource } from "./resources/transform-tag";
import { transformTestResource } from "./resources/transform-test";
import { uploadResource } from "./resources/upload";
import { userResource } from "./resources/user";
import { workspaceInstanceResource } from "./resources/workspace-instance";
import { workspaceManagerResource } from "./resources/workspace-manager";

// The return type is left for inference on purpose: `MetabaseClient` extends `ReturnType<typeof
// surfaceOn>`, so any annotation here would freeze the client at what that annotation names and the
// resource namespaces composed onto it would be invisible to every consumer.
function surfaceOn(transport: Transport) {
  return {
    apiKey: apiKeyResource(transport),
    card: cardResource(transport),
    collection: collectionResource(transport),
    contentTranslation: contentTranslationResource(transport),
    dashboard: dashboardResource(transport),
    dataAction: dataActionResource(transport),
    dataApp: dataAppResource(transport),
    database: databaseResource(transport),
    dataset: datasetResource(transport),
    dependency: dependencyResource(transport),
    document: documentResource(transport),
    eidTranslation: eidTranslationResource(transport),
    erd: erdResource(transport),
    field: fieldResource(transport),
    gitSync: gitSyncResource(transport),
    glossary: glossaryResource(transport),
    health: healthResource(transport),
    library: libraryResource(transport),
    measure: measureResource(transport),
    metric: metricResource(transport),
    moderationReview: moderationReviewResource(transport),
    notification: notificationResource(transport),
    permission: permissionResource(transport),
    pulse: pulseResource(transport),
    replacement: replacementResource(transport),
    revision: revisionResource(transport),
    search: searchResource(transport),
    segment: segmentResource(transport),
    session: sessionResource(transport),
    setting: settingResource(transport),
    setup: setupResource(transport),
    snippet: snippetResource(transport),
    table: tableResource(transport),
    task: taskResource(transport),
    timeline: timelineResource(transport),
    timelineEvent: timelineEventResource(transport),
    transform: transformResource(transport),
    transformDagRun: transformDagRunResource(transport),
    transformInspector: transformInspectorResource(transport),
    transformJob: transformJobResource(transport),
    transformPython: transformPythonResource(transport),
    transformTag: transformTagResource(transport),
    transformTest: transformTestResource(transport),
    upload: uploadResource(transport),
    user: userResource(transport),
    workspaceInstance: workspaceInstanceResource(transport),
    workspaceManager: workspaceManagerResource(transport),
    server: transport.server,
    verifiedServer: transport.verifiedServer,
    probesSettled: transport.probesSettled,
    // The escape hatch: an endpoint the client never models still has to cost a consumer nothing.
    requestParsed: transport.requestParsed,
    requestRaw: transport.requestRaw,
    requestStream: transport.requestStream,
  };
}

type ClientSurface = ReturnType<typeof surfaceOn>;

export interface MetabaseClient extends ClientSurface {
  // A client on this one's transport: the same credential and server profile, so it probes nothing
  // this one holds, with its own user agent, signal, guard and error observer.
  with(options: DerivedClientOptions): MetabaseClient;
}

export function createClient(config: ClientCredentials, options: ClientOptions): MetabaseClient {
  const observers = options.onError === undefined ? [] : [options.onError];
  return clientOn(createTransport(config, options), observers);
}

function clientOn(transport: Transport, observers: readonly ErrorObserver[]): MetabaseClient {
  const client: MetabaseClient = {
    ...surfaceOn(transport),
    with: (derived) => {
      const inherited = derived.onError === undefined ? observers : [derived.onError, ...observers];
      return clientOn(transport.with(derived), inherited);
    },
  };
  return observers.length === 0 ? client : observed(client, observers);
}

// `surface` with every error a call on it raises shown to `observers` before its caller sees it: a
// throw, a rejection, or a failure while walking an async iterable it answered. A namespace on it is
// observed the same way, so the surface needs no list of the methods it carries.
function observed<T extends object>(surface: T, observers: readonly ErrorObserver[]): T {
  const namespaces = new Map<PropertyKey, object>();
  return new Proxy(surface, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value === "function") {
        return (...args: unknown[]): unknown =>
          observedCall(() => Reflect.apply(value, target, args), observers);
      }
      if (typeof value !== "object" || value === null) {
        return value;
      }
      const known = namespaces.get(property);
      if (known !== undefined) {
        return known;
      }
      const namespace = observed(value, observers);
      namespaces.set(property, namespace);
      return namespace;
    },
  });
}

function observedCall(call: () => unknown, observers: readonly ErrorObserver[]): unknown {
  let result: unknown;
  try {
    result = call();
  } catch (error) {
    throw shown(error, observers);
  }
  if (result instanceof Promise) {
    return result.catch((error: unknown) => {
      throw shown(error, observers);
    });
  }
  if (isAsyncIterable(result)) {
    return observedWalk(result, observers);
  }
  return result;
}

async function* observedWalk(
  walk: AsyncIterable<unknown>,
  observers: readonly ErrorObserver[],
): AsyncGenerator<unknown> {
  try {
    yield* walk;
  } catch (error) {
    throw shown(error, observers);
  }
}

function shown(error: unknown, observers: readonly ErrorObserver[]): unknown {
  for (const observe of observers) {
    observe(error);
  }
  return error;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof value[Symbol.asyncIterator] === "function"
  );
}
