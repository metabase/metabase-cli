import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { createClient } from "../client";
import { errorMessage } from "../errors";
import type { ClientCredentials, Transport } from "../http/transport";
import { cardResource } from "../resources/card";
import { collectionResource } from "../resources/collection";
import { contentTranslationResource } from "../resources/content-translation";
import { dashboardResource } from "../resources/dashboard";
import { databaseResource } from "../resources/database";
import { datasetResource } from "../resources/dataset";
import { dependencyResource } from "../resources/dependency";
import { documentResource } from "../resources/document";
import { eidTranslationResource } from "../resources/eid-translation";
import { erdResource } from "../resources/erd";
import { fieldResource } from "../resources/field";
import { gitSyncResource } from "../resources/git-sync";
import { glossaryResource } from "../resources/glossary";
import { libraryResource } from "../resources/library";
import { measureResource } from "../resources/measure";
import { metricResource } from "../resources/metric";
import { moderationReviewResource } from "../resources/moderation-review";
import { notificationResource } from "../resources/notification";
import { pulseResource } from "../resources/pulse";
import { replacementResource } from "../resources/replacement";
import { revisionResource } from "../resources/revision";
import { searchResource } from "../resources/search";
import { segmentResource } from "../resources/segment";
import { settingResource } from "../resources/setting";
import { setupResource } from "../resources/setup";
import { snippetResource } from "../resources/snippet";
import { tableResource } from "../resources/table";
import { timelineEventResource } from "../resources/timeline-event";
import { timelineResource } from "../resources/timeline";
import { transformDagRunResource } from "../resources/transform-dag-run";
import { transformInspectorResource } from "../resources/transform-inspector";
import { transformJobResource } from "../resources/transform-job";
import { transformPythonResource } from "../resources/transform-python";
import { transformResource } from "../resources/transform";
import { transformTagResource } from "../resources/transform-tag";
import { uploadResource } from "../resources/upload";
import { userResource } from "../resources/user";
import { createFakeClient } from "../testing/fake-client";
import { TEST_USER_AGENT } from "../testing/fetch-capture";

import { FEATURE_RULES, type FeatureRule } from "./features";
import { createServerProfile } from "./profile";
import {
  isMethodKey,
  METHOD_REQUIREMENTS,
  type MethodKey,
  methodRequirements,
} from "./requirements";

const RESOURCES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "resources");

const CREDENTIALS: ClientCredentials = {
  url: "https://m.example.com",
  credential: { kind: "apiKey", apiKey: "mb_requirements_key" },
};

// A method that picks its wire shape by generation reads the profile between asking and requesting.
const SERVER = createServerProfile({
  edition: "oss",
  version: { tag: "v0.63.0", major: 63, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: null,
});

const ESCAPE_HATCHES: ReadonlySet<string> = new Set([
  "server",
  "requestParsed",
  "requestRaw",
  "requestStream",
]);

const TABLE_KEYS: ReadonlyArray<string> = Object.keys(METHOD_REQUIREMENTS).toSorted();

const noNetwork: typeof fetch = () => {
  throw new Error("the requirements table is enumerated without a socket");
};

function methodKeysOnClient(): string[] {
  const client = createClient(CREDENTIALS, { userAgent: TEST_USER_AGENT, fetchImpl: noNetwork });
  const keys: string[] = [];
  for (const [namespace, resource] of Object.entries(client)) {
    if (ESCAPE_HATCHES.has(namespace) || typeof resource !== "object" || resource === null) {
      continue;
    }
    for (const [method, value] of Object.entries(resource)) {
      if (typeof value === "function") {
        keys.push(`${namespace}.${method}`);
      }
    }
  }
  return keys.toSorted();
}

function namespaceOf(fileName: string): string {
  const [head, ...rest] = fileName.replace(/\.ts$/, "").split("-");
  return [head, ...rest.map((part) => part[0]?.toUpperCase() + part.slice(1))].join("");
}

interface RequiredLiteral {
  readonly file: string;
  readonly key: string;
  // The function whose body holds the call, named as the resource exposes it.
  readonly method: string;
}

const RESOURCE_FACTORY_SUFFIX = "Resource";
const TRANSPORT_PARAMETER = "transport";
const REQUIRE_METHOD = "require";

function parseSource(file: string): ts.SourceFile {
  const text = readFileSync(resolve(RESOURCES_DIR, file), "utf8");
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
}

function descendantsOf(node: ts.Node): ts.Node[] {
  const found: ts.Node[] = [];
  const visit = (child: ts.Node): void => {
    found.push(child);
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

function isExportedResourceFactory(statement: ts.Statement): statement is ts.FunctionDeclaration {
  if (!ts.isFunctionDeclaration(statement) || statement.name === undefined) {
    return false;
  }
  const exported = (ts.getCombinedModifierFlags(statement) & ts.ModifierFlags.Export) !== 0;
  return exported && statement.name.text.endsWith(RESOURCE_FACTORY_SUFFIX);
}

function resourceFactoryOf(source: ts.SourceFile): ts.FunctionDeclaration | null {
  const factories = source.statements.filter(isExportedResourceFactory);
  if (factories.length > 1) {
    throw new Error(`${source.fileName}: ${factories.length} resource factories in one file`);
  }
  const [factory] = factories;
  return factory ?? null;
}

type ExposedEntry = readonly [declared: string, exposed: string];

function exposedEntryOf(property: ts.ObjectLiteralElementLike, file: string): ExposedEntry {
  if (ts.isShorthandPropertyAssignment(property)) {
    return [property.name.text, property.name.text];
  }
  const aliased =
    ts.isPropertyAssignment(property) &&
    ts.isIdentifier(property.name) &&
    ts.isIdentifier(property.initializer);
  if (!aliased) {
    throw new Error(
      `${file}: \`${property.getText()}\` exposes something other than a declared function`,
    );
  }
  return [property.initializer.text, property.name.text];
}

// `{ delete: remove, import: importFromRemote }`: the name a caller reaches a method by, for a
// function whose own name is a reserved word.
function exposedNamesOf(
  factory: ts.FunctionDeclaration,
  file: string,
): ReadonlyMap<string, string> {
  const returned = factory.body?.statements.find(ts.isReturnStatement);
  if (returned?.expression === undefined || !ts.isObjectLiteralExpression(returned.expression)) {
    throw new Error(`${file}: the resource factory returns no object literal`);
  }
  return new Map(returned.expression.properties.map((property) => exposedEntryOf(property, file)));
}

function isRequireCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
    return false;
  }
  const { expression: receiver, name } = node.expression;
  return (
    ts.isIdentifier(receiver) &&
    receiver.text === TRANSPORT_PARAMETER &&
    name.text === REQUIRE_METHOD
  );
}

function requiredKeyOf(call: ts.CallExpression, file: string): string {
  const [key] = call.arguments;
  if (key === undefined || !ts.isStringLiteral(key)) {
    throw new Error(
      `${file}: \`${call.getText()}\` asks for something other than a string literal`,
    );
  }
  return key.text;
}

function enclosingDeclaredFunction(
  call: ts.CallExpression,
  factory: ts.FunctionDeclaration,
  file: string,
): string {
  let current: ts.Node = call.parent;
  while (current !== factory) {
    if (ts.isFunctionDeclaration(current) && current.name !== undefined) {
      return current.name.text;
    }
    current = current.parent;
  }
  throw new Error(`${file}: \`${call.getText()}\` sits outside a declared method`);
}

function requiredLiterals(): RequiredLiteral[] {
  return readdirSync(RESOURCES_DIR)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .flatMap((file) => {
      const factory = resourceFactoryOf(parseSource(file));
      if (factory === null) {
        return [];
      }
      const exposed = exposedNamesOf(factory, file);
      return descendantsOf(factory)
        .filter(isRequireCall)
        .map((call) => {
          const declared = enclosingDeclaredFunction(call, factory, file);
          return {
            file,
            key: requiredKeyOf(call, file),
            method: exposed.get(declared) ?? declared,
          };
        });
    });
}

// One call per resource, with the wire request the fake refuses once the method reaches it — the
// refusal proves the method went to the wire only after it asked.
interface ResourceDrive {
  readonly key: MethodKey;
  readonly invoke: (transport: Transport) => Promise<unknown>;
  readonly wireError: string;
}

const CSV = { filename: "rows.csv", bytes: new TextEncoder().encode("a\n1\n") };

const DRIVES: ReadonlyArray<ResourceDrive> = [
  {
    key: "card.get",
    invoke: (t) => cardResource(t).get(1),
    wireError: "unexpected request: GET /api/card/1",
  },
  {
    key: "collection.tree",
    invoke: (t) => collectionResource(t).tree(),
    wireError: "unexpected request: GET /api/collection/tree",
  },
  {
    key: "contentTranslation.download",
    invoke: (t) => contentTranslationResource(t).download(),
    wireError: "requestStream not implemented in fake client",
  },
  {
    key: "dashboard.get",
    invoke: (t) => dashboardResource(t).get(1),
    wireError: "unexpected request: GET /api/dashboard/1",
  },
  {
    key: "database.schemas",
    invoke: (t) => databaseResource(t).schemas(1),
    wireError: "unexpected request: GET /api/database/1/schemas",
  },
  {
    key: "dataset.query",
    invoke: (t) => datasetResource(t).query({}),
    wireError: "unexpected request: POST /api/dataset",
  },
  {
    key: "dependency.graph",
    invoke: (t) => dependencyResource(t).graph("card", 1),
    wireError: "unexpected request: GET /api/ee/dependencies/graph",
  },
  {
    key: "document.get",
    invoke: (t) => documentResource(t).get(1),
    wireError: "unexpected request: GET /api/document/1",
  },
  {
    key: "eidTranslation.translate",
    invoke: (t) => eidTranslationResource(t).translate({ entity_ids: {} }),
    wireError: "unexpected request: POST /api/eid-translation/translate",
  },
  {
    key: "erd.get",
    invoke: (t) => erdResource(t).get({ "database-id": 1 }),
    wireError: "unexpected request: GET /api/ee/erd",
  },
  {
    key: "field.get",
    invoke: (t) => fieldResource(t).get(1),
    wireError: "unexpected request: GET /api/field/1",
  },
  {
    key: "gitSync.branches",
    invoke: (t) => gitSyncResource(t).branches(),
    wireError: "unexpected request: GET /api/ee/remote-sync/branches",
  },
  {
    key: "glossary.list",
    invoke: (t) => glossaryResource(t).list(),
    wireError: "unexpected request: GET /api/glossary",
  },
  {
    key: "library.get",
    invoke: (t) => libraryResource(t).get(),
    wireError: "unexpected request: GET /api/ee/library/",
  },
  {
    key: "measure.get",
    invoke: (t) => measureResource(t).get(1),
    wireError: "unexpected request: GET /api/measure/1",
  },
  {
    key: "metric.dimensions",
    invoke: (t) => metricResource(t).dimensions(1),
    wireError: "unexpected request: GET /api/metric/1/dimension",
  },
  {
    key: "moderationReview.create",
    invoke: (t) =>
      moderationReviewResource(t).create({ moderated_item_id: 1, moderated_item_type: "card" }),
    wireError: "unexpected request: POST /api/moderation-review",
  },
  {
    key: "notification.get",
    invoke: (t) => notificationResource(t).get(1),
    wireError: "unexpected request: GET /api/notification/1",
  },
  {
    key: "pulse.get",
    invoke: (t) => pulseResource(t).get(1),
    wireError: "unexpected request: GET /api/pulse/1",
  },
  {
    key: "replacement.getRun",
    invoke: (t) => replacementResource(t).getRun(1),
    wireError: "unexpected request: GET /api/ee/replacement/runs/1",
  },
  {
    key: "revision.list",
    invoke: (t) => revisionResource(t).list("card", 1),
    wireError: "unexpected request: GET /api/revision/card/1",
  },
  {
    key: "search.query",
    invoke: (t) => searchResource(t).query(),
    wireError: "unexpected request: GET /api/search",
  },
  {
    key: "segment.get",
    invoke: (t) => segmentResource(t).get(1),
    wireError: "unexpected request: GET /api/segment/1",
  },
  {
    key: "setting.list",
    invoke: (t) => settingResource(t).list(),
    wireError: "unexpected request: GET /api/setting",
  },
  {
    key: "setup.create",
    invoke: (t) =>
      setupResource(t).create({
        token: "setup-token",
        user: { email: "admin@example.com", password: "pw" },
        prefs: { site_name: "Test" },
      }),
    wireError: "unexpected request: POST /api/setup",
  },
  {
    key: "snippet.get",
    invoke: (t) => snippetResource(t).get(1),
    wireError: "unexpected request: GET /api/native-query-snippet/1",
  },
  {
    key: "table.get",
    invoke: (t) => tableResource(t).get(1),
    wireError: "unexpected request: GET /api/table/1",
  },
  {
    key: "timeline.get",
    invoke: (t) => timelineResource(t).get(1),
    wireError: "unexpected request: GET /api/timeline/1",
  },
  {
    key: "timelineEvent.get",
    invoke: (t) => timelineEventResource(t).get(1),
    wireError: "unexpected request: GET /api/timeline-event/1",
  },
  {
    key: "transform.get",
    invoke: (t) => transformResource(t).get(1),
    wireError: "unexpected request: GET /api/transform/1",
  },
  {
    key: "transformDagRun.transformRuns",
    invoke: (t) => transformDagRunResource(t).transformRuns(1),
    wireError: "unexpected request: GET /api/transform-dag-run/1/transform-runs",
  },
  {
    key: "transformInspector.discover",
    invoke: (t) => transformInspectorResource(t).discover(1),
    wireError: "unexpected request: GET /api/ee/transforms/1/inspect",
  },
  {
    key: "transformJob.get",
    invoke: (t) => transformJobResource(t).get(1),
    wireError: "unexpected request: GET /api/transform-job/1",
  },
  {
    key: "transformPython.getLibrary",
    invoke: (t) => transformPythonResource(t).getLibrary("common"),
    wireError: "unexpected request: GET /api/ee/transforms-python/library/common",
  },
  {
    key: "transformTag.list",
    invoke: (t) => transformTagResource(t).list(),
    wireError: "unexpected request: GET /api/transform-tag",
  },
  {
    key: "upload.createFromCsv",
    invoke: (t) => uploadResource(t).createFromCsv(CSV, { collection_id: "1" }),
    wireError: "requestRaw not implemented in fake client",
  },
  {
    key: "user.current",
    invoke: (t) => userResource(t).current(),
    wireError: "unexpected request: GET /api/user/current",
  },
];

async function messageOf(pending: Promise<unknown>): Promise<string> {
  try {
    await pending;
  } catch (error) {
    return errorMessage(error);
  }
  return "resolved";
}

describe("METHOD_REQUIREMENTS", () => {
  it("names exactly the methods the client exposes", () => {
    expect(methodKeysOnClient()).toEqual(TABLE_KEYS);
  });

  it("is required by every resource method under the method's own key, and by nothing else", () => {
    const literals = requiredLiterals();
    const foreign = literals.filter(
      ({ file, key, method }) => key !== `${namespaceOf(file)}.${method}`,
    );
    expect(foreign).toEqual([]);
    expect(literals.map(({ key }) => key).toSorted()).toEqual(TABLE_KEYS);
  });

  // A requirement says the route exists on the server; a rule that ends at some major describes
  // a shape an older server had, and refusing on it would name a floor the server is above.
  it("requires no feature bounded by `until`", () => {
    const bounded = Object.entries(METHOD_REQUIREMENTS).flatMap(([key, features]) =>
      features
        .filter((feature) => {
          const rule: FeatureRule = FEATURE_RULES[feature];
          return rule.until !== undefined;
        })
        .map((feature) => `${key}: ${feature}`),
    );
    expect(bounded).toEqual([]);
  });

  it("has every resource namespace driven below", () => {
    const driven = new Set(DRIVES.map((drive) => drive.key.split(".")[0]));
    const named = new Set(TABLE_KEYS.map((key) => key.split(".")[0]));
    expect([...driven].toSorted()).toEqual([...named].toSorted());
  });

  it.each(DRIVES)("$key asks the transport before its first request", async (drive) => {
    const fake = createFakeClient({ server: SERVER });

    expect(await messageOf(drive.invoke(fake.client))).toBe(drive.wireError);
    expect(fake.required).toEqual([{ key: drive.key, precedingRequests: 0 }]);
  });
});

describe("isMethodKey", () => {
  it("admits a key the table names and refuses one it does not", () => {
    expect(isMethodKey("card.list")).toBe(true);
    expect(isMethodKey("card.explode")).toBe(false);
  });
});

describe("methodRequirements", () => {
  it("answers the table's own entry", () => {
    expect(methodRequirements("transformJob.setActive")).toEqual([
      "transformJobActivation",
      "transforms",
    ]);
    expect(methodRequirements("card.list")).toEqual([]);
  });
});
