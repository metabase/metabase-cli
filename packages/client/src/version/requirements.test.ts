import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
import { documentResource } from "../resources/document";
import { eidTranslationResource } from "../resources/eid-translation";
import { fieldResource } from "../resources/field";
import { gitSyncResource } from "../resources/git-sync";
import { libraryResource } from "../resources/library";
import { measureResource } from "../resources/measure";
import { notificationResource } from "../resources/notification";
import { pulseResource } from "../resources/pulse";
import { searchResource } from "../resources/search";
import { segmentResource } from "../resources/segment";
import { settingResource } from "../resources/setting";
import { setupResource } from "../resources/setup";
import { snippetResource } from "../resources/snippet";
import { tableResource } from "../resources/table";
import { timelineEventResource } from "../resources/timeline-event";
import { timelineResource } from "../resources/timeline";
import { transformJobResource } from "../resources/transform-job";
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

const REQUIRE_CALL = /transport\.require\("([^"]+)", options\)/g;
const FUNCTION_DECLARATION = /function\*? ([A-Za-z]+)\(/g;
const RETURNED_OBJECT = /return \{([^}]*)\}/g;
const ALIASED_ENTRY = /([A-Za-z]+): ([A-Za-z]+)/g;

// `{ delete: remove, import: importFromRemote }`: the name a caller reaches a method by, for a
// function whose own name is a reserved word. Only a declared function counts as aliased, so a
// returned data object (`{ data: rows, total: null }`) contributes nothing.
function exposedNamesOf(source: string): ReadonlyMap<string, string> {
  const declaredFunctions = new Set(
    [...source.matchAll(FUNCTION_DECLARATION)].flatMap((match) =>
      match[1] === undefined ? [] : [match[1]],
    ),
  );
  const entries = [...source.matchAll(RETURNED_OBJECT)].flatMap((object) =>
    object[1] === undefined ? [] : Array.from(object[1].matchAll(ALIASED_ENTRY)),
  );
  return new Map(
    entries.flatMap(([, exposed, declared]) =>
      exposed !== undefined && declared !== undefined && declaredFunctions.has(declared)
        ? [[declared, exposed]]
        : [],
    ),
  );
}

function enclosingFunctionAt(source: string, index: number): string {
  let enclosing: string | null = null;
  for (const match of source.matchAll(FUNCTION_DECLARATION)) {
    if (match.index > index) {
      break;
    }
    enclosing = match[1] ?? null;
  }
  if (enclosing === null) {
    throw new Error(`no function declared before offset ${index}`);
  }
  return enclosing;
}

function requiredLiterals(): RequiredLiteral[] {
  return readdirSync(RESOURCES_DIR)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .flatMap((file) => {
      const source = readFileSync(resolve(RESOURCES_DIR, file), "utf8");
      const exposed = exposedNamesOf(source);
      return [...source.matchAll(REQUIRE_CALL)].flatMap((match) => {
        const key = match[1];
        if (key === undefined) {
          return [];
        }
        const declared = enclosingFunctionAt(source, match.index);
        return [{ file, key, method: exposed.get(declared) ?? declared }];
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
    key: "transformJob.get",
    invoke: (t) => transformJobResource(t).get(1),
    wireError: "unexpected request: GET /api/transform-job/1",
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
