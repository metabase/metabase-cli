# @metabase/client

The Metabase API client behind [`@metabase/cli`](../../README.md). It owns the HTTP boundary, a Zod
schema per Metabase resource, the OAuth login flow, and the server version model.

The package is workspace-internal (`private: true`). `@metabase/cli` consumes it from source and
inlines it at build time via tsdown's `noExternal`, so the published CLI has no runtime dependency
on it.

`tsdown` here emits one ESM module and one declaration file per `exports` entry into `dist/`, and the
map names those rather than the source. Installing the packed tarball therefore gets JavaScript Node
can load and declarations `moduleResolution: node16` can follow, with no `@types/node` required.

## Dependency budget

The one runtime dependency is `zod`, and it is a **peer** dependency: every schema on this surface is a zod schema, so the consumer's zod is part of the contract and a resolver must be told to reconcile the two rather than left free to add a second copy. A production module under `src/` imports nothing beyond it and `node:` builtins; test files may reach the root devDependencies.

The package is also free of process I/O: it does not touch `process` at all — no filesystem access,
no subprocesses, no writes to the process streams, no `process.exit`, no signal handlers, no
interactive prompting. Cancellation, credential storage, prompting, and rendering belong to the host
application. `../../CLAUDE.md` carries this abstention and the package's internal layering — one
module per cross-cutting boundary — along with the reasoning behind each.

That abstention extends to the process TLS trust store, and it is a behavioural difference worth
knowing about. Node trusts only its bundled Mozilla CA list unless told otherwise, so a Metabase
served behind a corporate proxy or a local development CA fails certificate verification. The CLI
merges the OS trust store into Node's defaults at startup; an embedder of this package gets no such
merge, because a library must not reconfigure its host's trust store. Run the host process with
`NODE_USE_SYSTEM_CA=1`, pass `NODE_EXTRA_CA_CERTS=<pem>`, or call `tls.setDefaultCACertificates()`
yourself if you need the same reach.

## Authentication

A `Credential` is either an API key or an OAuth grant, and a client takes one at construction. An API
key is the shortest path: mint one in Metabase under Settings → Authentication → API keys, and hand
it over as an `ApiKeyCredential`.

```ts
import { createClient } from "@metabase/client";

const mb = createClient(
  { url: "https://metabase.example.com", credential: { kind: "apiKey", apiKey: "mb_..." } },
  { userAgent: "my-app/1.0.0" },
);

const me = await mb.user.current();
console.log(me.email, me.is_superuser);
```

`userAgent` is required and is the caller's whole string — the client never prefixes, wraps or composes
it, so what an application declares is what Metabase sees on the wire.

OAuth authenticates as a person rather than as a service account. `oauthLogin` runs the
authorization-code flow with PKCE against a loopback redirect: `openBrowser` and `onAuthorizeUrl` are
the caller's, so the client never decides how a URL reaches a user, and `clientName` is what dynamic
client registration persists on the user's Metabase. Access tokens expire and refresh tokens rotate,
so a long-lived client passes `refreshCredential` and keeps the newest grant.

Binding a loopback listener and waiting on a browser is not something a harness can drive unattended,
so the block below is fenced `illustrative`: the extractor compiles it and stops there.

```ts illustrative
import { createClient, oauthLogin, refreshOAuthCredential } from "@metabase/client";

const baseUrl = "https://metabase.example.com";
const userAgent = "my-app/1.0.0";

let credential = await oauthLogin(
  { baseUrl, userAgent, clientName: "My App" },
  {
    openBrowser: async () => false,
    onAuthorizeUrl: (url) => console.log(`Authorize this app at ${url}`),
    now: () => Date.now(),
  },
);

const mb = createClient(
  { url: baseUrl, credential },
  {
    userAgent,
    refreshCredential: async () => {
      credential = await refreshOAuthCredential(baseUrl, credential, Date.now(), userAgent);
      return credential;
    },
  },
);
```

`revokeOAuthCredential(baseUrl, credential, userAgent)` ends the grant server-side, and answers
whether the server advertised a revocation endpoint at all.

## Usage

`createClient` is the entry point, and what it returns carries one namespace per Metabase resource —
each named after what Metabase calls the thing — reached as `mb.<resource>.<method>(…)`. Path
parameters come first, then Metabase's own field names, then the transport options.

```ts
import { createClient } from "@metabase/client";

const mb = createClient(
  { url: "https://metabase.example.com", credential: { kind: "apiKey", apiKey: "mb_..." } },
  { userAgent: "my-app/1.0.0" },
);

const card = await mb.card.get(42);
console.log(card.id, card.name, card.type);
```

Every resource method is a `requestParsed(schema, path, opts)` call against a `domain/` schema, so a
response is a typed value or a throw from the error taxonomy below; `### Endpoints the client does not
model` reaches that method directly, for a path no namespace covers.

### Paging a list endpoint

Metabase list endpoints come in two shapes and the difference is per-endpoint, not uniform — check
the one you are calling before assuming either. `/api/card` is a bare array; `/api/database` and
`/api/collection/{id}/items` wrap their rows in `{ data, total }`.

A method over an endpoint that answers in one response returns a `ListResult<T>` — `{ data, total }`
whichever shape the endpoint sent, with `total` the server's own count where it reports one and
`null` where the rows in hand are all there are.

```ts
import { createClient } from "@metabase/client";

const mb = createClient(
  { url: "https://metabase.example.com", credential: { kind: "apiKey", apiKey: "mb_..." } },
  { userAgent: "my-app/1.0.0" },
);

const cards = await mb.card.list({ f: "mine" });
console.log(cards.data.length, cards.total);
```

A resource method whose endpoint pages answers an `AsyncIterable<Page<T>>` — `mb.collection.itemPages`,
`mb.transform.runPages`, `mb.transform.runSummaryPages`, `mb.dependency.unreferencedPages` and
`mb.dependency.breakingPages` are the five — requesting `limit`/`offset` pages and yielding a `Page<T>`
(`{ items: T[], total: number | null }`) per request, so the server's count reaches you instead of
being spent on loop control.

```ts
import { createClient } from "@metabase/client";

const mb = createClient(
  { url: "https://metabase.example.com", credential: { kind: "apiKey", apiKey: "mb_..." } },
  { userAgent: "my-app/1.0.0" },
);

for await (const page of mb.collection.itemPages("root")) {
  for (const item of page.items) {
    console.log(item.id, item.name, page.total);
  }
}
```

The walk behind them is `paginatePages` at `@metabase/client/paginate`, for an endpoint no resource
method covers. It requires one that both wraps its rows and honors `offset`: pointed at a bare array
it throws `ResponseShapeError`, and at an endpoint that ignores `offset` it throws `ConfigError`
rather than looping forever.

### Writing

A write method takes Metabase's own field names, described by the `<Resource>CreateInput` or
`<Resource>UpdateInput` schema sitting in the same `domain/` module as the resource. `create` answers
the full created resource, `update` patches only the fields its body carries, and `archive` is the
soft-delete Metabase models as an update rather than as its own endpoint.

```ts
import { createClient, type CardCreateInput } from "@metabase/client";

const mb = createClient(
  { url: "https://metabase.example.com", credential: { kind: "apiKey", apiKey: "mb_..." } },
  { userAgent: "my-app/1.0.0" },
);

const body: CardCreateInput = {
  name: "Orders per month",
  type: "question",
  display: "line",
  visualization_settings: {},
  collection_id: 4,
  dataset_query: {
    "lib/type": "mbql/query",
    database: 1,
    stages: [
      {
        "lib/type": "mbql.stage/mbql",
        "source-table": 7,
        aggregation: [["count", {}]],
        breakout: [["field", { "temporal-unit": "month" }, 22]],
      },
    ],
  },
};

const card = await mb.card.create(body);
await mb.card.update(card.id, { description: "Order count, grouped by month." });
await mb.card.archive(card.id);
```

A write is never replayed on a failed status: the transport retries GET/HEAD/OPTIONS on a retryable
status code, and every other method only on a network or timeout failure. Where the endpoint behind a
write genuinely tolerates a resend, say so with `idempotent: true` in the trailing options.

### Handling errors

Everything the client throws is either a `MetabaseError` or a Node error it deliberately leaves alone.
`toMetabaseError` normalizes an unknown throw into the taxonomy; `isHttpNotFound` answers whether one
came off the wire as a 404; `isFileNotFoundError` answers the unrelated question of a file that is not
on disk.

```ts
import { readFile } from "node:fs/promises";

import {
  CardCreateInput,
  createClient,
  isFileNotFoundError,
  isHttpNotFound,
  parseJson,
  toMetabaseError,
} from "@metabase/client";

const mb = createClient(
  { url: "https://metabase.example.com", credential: { kind: "apiKey", apiKey: "mb_..." } },
  { userAgent: "my-app/1.0.0" },
);

try {
  const source = await readFile("./card.json", "utf8");
  await mb.card.create(parseJson(source, CardCreateInput, { source: "card.json" }));
} catch (error) {
  if (isFileNotFoundError(error)) {
    console.error("no such file: ./card.json");
  } else if (isHttpNotFound(error)) {
    console.error("the collection this card names is gone");
  } else {
    const failure = toMetabaseError(error);
    console.error(failure.category, failure.userMessage, failure.isRetryable);
  }
}
```

The two checks answer different questions and neither substitutes for the other: `isFileNotFoundError`
tests for a Node `ENOENT`, while an HTTP 404 arrives as an `HttpError` carrying `status: 404`. That
`HttpError` also carries a `kind` separating a route this Metabase does not serve from a row that is
gone, and `fieldErrors` for a 400 the server attributed to named request fields.

### Cancellation

The client registers no signal handler and reads no process state, so cancellation reaches it as an
`AbortSignal` the host owns. Three places take one and they compose: `ClientOptions.signal` cancels
every request a client makes, `RequestOptions.signal` cancels a single request, and
`PollOptions.signal` stops a wait loop. Each is folded together with the request timeout, so whichever
fires first ends the work. A method's first call may also wait on the client's one shared server probe; the method's `signal` ends that caller's wait, while the probe itself belongs to the client and is cancelled only by `ClientOptions.signal`, so a later call still finds it settled.

```ts
import { createClient, isTransformRunTerminal, pollUntil } from "@metabase/client";

const shutdown = new AbortController();
process.on("SIGINT", () => shutdown.abort());

const mb = createClient(
  { url: "https://metabase.example.com", credential: { kind: "apiKey", apiKey: "mb_..." } },
  { userAgent: "my-app/1.0.0", signal: shutdown.signal },
);

const cards = await mb.card.list({ f: "mine" }, { signal: AbortSignal.timeout(5_000) });

const finished = await pollUntil(
  async (signal) => mb.transform.getRun(42, { signal }),
  (run) => isTransformRunTerminal(run.status),
  { intervalMs: 1_000, backoff: "exponential", signal: shutdown.signal },
);

console.log(cards.data.length, finished.status);
```

A poll that ends because the caller's signal aborted rethrows that signal's own reason, so a
cancellation is never reported back as a polling `TimeoutError`.

### Servers of different versions

The client supports a window of Metabase majors, `KNOWN_RANGE`, and resolves a `ServerProfile` for the server it talks to — from `/api/session/properties` on the first call that needs it, or from a profile the host cached earlier and passes as `ClientOptions.server`. Every resource method declares the features it needs and refuses before any request leaves when the profile lacks one, so a consumer never sends a request the server cannot answer.

```ts
import { CapabilityError, createClient } from "@metabase/client";

const mb = createClient(
  { url: "https://metabase.example.com", credential: { kind: "apiKey", apiKey: "mb_..." } },
  { userAgent: "my-app/1.0.0" },
);

const server = await mb.server();
console.log(server.version?.tag, server.edition, server.skew, server.features.transforms);

try {
  await mb.transformJob.setActive(true);
} catch (error) {
  if (error instanceof CapabilityError) {
    console.log(error.developerDetail.reason, error.developerDetail.feature, error.message);
  }
}
```

A parameter only some servers honour is refused the same way when it is given: `mb.table.list({ "can-query": true })` asks for the access filters below 59, and `mb.field.update(id, { data_sensitivity })` for the sensitivity column below 64, each with the `CapabilityError` naming the feature; without the parameter neither method consults the profile. A vocabulary the server spells differently by generation is refused by value: `data_layer` is `final`, `internal` or `hidden` from 59 on (`TableDataLayerTier`) and `gold`, `silver`, `bronze` or `copper` on 58 (`TableDataLayerMedallion`), and `mb.table.update` refuses a tier name below 59 by feature and a medallion name from 59 on as a `ConfigError`.

A method's return type is the shape the newest supported server answers. Where an older server answers differently, the method parses that server's exact wire shape and converts it forward, so `mb.transform.get(5)` carries `target_table_id` on every server (a hydrated `table` on the oldest generations, the column on the rest), `mb.transformJob.run(2)` answers `{ message, started, run_id }` whether the server reports an opaque stub or a numeric run id, and each of `mb.library.get()`'s `effective_children` is `{ id, name, description, type, is_remote_synced }`. A field the server cannot report is `null`; the profile's `features` say why. A response that fails its generation's schema is a `ResponseShapeError` naming the server version and the fields that were off — never a silent fallback to another shape.

A server newer than the window, or a head build whose tag does not parse, is placed one past the newest known major — the slot a rule written against head describes — with `skew` set to `"newer-than-known"` or `"unknown"`; its additions pass through the loose schemas, and only a token feature can refuse it. A server older than the window is `"older-than-known"`, evaluated at its own major, so each method it lacks refuses by name. The client never takes a version from the caller: a profile comes from a probe, so two consumers of one server cannot disagree about what it is.

### Endpoints the client does not model

`createClient` forwards `requestParsed`, `requestRaw` and `requestStream` off the transport it builds,
so an endpoint with no resource method behind it costs a schema and a path rather than a second HTTP
client. `requestParsed(schema, path, opts)` takes the schema first, and the path is joined to the
instance URL by concatenation, so a Metabase served under a subpath needs nothing extra.

```ts
import { z } from "zod";

import { createClient } from "@metabase/client";

const PermissionsGroup = z
  .object({ id: z.number().int(), name: z.string(), member_count: z.number().int() })
  .loose();

const mb = createClient(
  { url: "https://metabase.example.com", credential: { kind: "apiKey", apiKey: "mb_..." } },
  { userAgent: "my-app/1.0.0" },
);

const groups = await mb.requestParsed(z.array(PermissionsGroup), "/api/permissions/group");
for (const group of groups) {
  console.log(group.id, group.name, group.member_count);
}
```

`requestRaw` answers the `Response` for a caller that wants a header or a status code, and
`requestStream` a `ReadableStream` for a download. All three take the same `TransportRequestOptions`,
so `method`, `query`, `body` and `expectContentType` are set the way a resource method sets them.

`@metabase/client` re-exports the curated surface below, and the samples above import from it. The
package manifest's `exports` map names what is also reachable directly at `@metabase/client/<path>` —
`@metabase/client/http/transport`, `@metabase/client/testing/fake-client`, every file under `domain/`
and `resources/` — for what the barrel does not carry, which is how `paginatePages` is reached at
`@metabase/client/paginate`. A module the map does not name is package-internal and free to move.

## Public surface

### Client and transport

`createClient(credentials, options)` is the entry point: it builds a transport and returns a
`MetabaseClient` forwarding the three request methods, so an endpoint the client does not model still
costs a consumer nothing. `MetabaseClient` is `ReturnType<typeof createClient>` rather than a written
interface, so it tracks the factory instead of freezing it.

`createTransport(credentials, options)` returns the `Transport` underneath, with the same three
methods: `requestParsed(schema, path, opts)` (the only typed-JSON path), `requestRaw`, and
`requestStream`. The caller supplies its own `userAgent`; the client never invents a wire identity.
Retries are idempotency-aware — GET/HEAD/OPTIONS retry on retryable status codes, other methods only
on network and timeout failures, and `RequestOptions.idempotent` overrides either default.

`TransportRequestOptions` is the whole wire request the three methods accept. `RequestOptions` is the
`{ signal, timeoutMs, retries, idempotent }` subset a caller hands to a higher-level method, leaving
`method`, `query`, `body` and `expectContentType` to that method. `ClientOptions.getServerTag` (a
`ServerTagResolver`) lets the host name the Metabase version a `ResponseShapeError` reports; the error's `serverSkew` is the profile's `skew`, and a `newer-than-known` server is named as newer than the client supports in the message's lead line.

Types: `MetabaseClient`, `Transport`, `ClientCredentials`, `ClientOptions`, `RequestOptions`,
`TransportRequestOptions`, `ServerTagResolver`, `HttpMethod`, `ExpectedContentType`, `QueryValue`,
`ListResult` (the `{ data, total }` a non-paginated list method returns).

### Errors

`MetabaseError` is the abstract root of the taxonomy: `NetworkError`, `TimeoutError`,
`ValidationError`, `ResponseShapeError`, `ConfigError`, `InternalError`, `AbortError`,
`ChainedRequestError`, `UnknownError`, and `HttpError`. Every one carries a `category`
(`ErrorCategory`), an `isRetryable`, a `userMessage`, and a `developerDetail` typed per class —
`NetworkErrorDetail`, `TimeoutErrorDetail` (the `HttpTimeoutDetail | PollingTimeoutDetail` union),
`ValidationErrorDetail`, `ResponseShapeErrorDetail` (the
`ZodResponseShapeDetail | DecodedResponseShapeDetail` union), `UnknownErrorDetail`,
`HttpErrorDetail`, and `null` where the class has nothing to add.

`ResponseShapeError` covers every 2xx whose payload the client cannot read: a schema parse failure
carries the request context and the Zod issues, and a hand-decoded body or header — a bare scalar, a
`metabase-…` response header — carries the source it was read from and the raw value.

`ConfigError` and `InternalError` split blame: the first is input a caller could correct, the second
is a caller that violated a function's contract, which is a bug in the calling code. `HttpError`
carries the status and response body, redacted of known secrets at construction, plus a `kind`
(`HttpErrorKind`) separating a route Metabase does not serve from a row that is gone;
`isHttpNotFound(value)` answers the coarser question of whether a thrown value is an `HttpError` with
status 404. `ChainedRequestError` wraps a cause and delegates its category and retryability to it.
`toMetabaseError(unknown)` normalizes a thrown value into the taxonomy.

Two helpers read raw thrown values away from the HTTP boundary. `isFileNotFoundError(value)` reports a
Node `ENOENT` filesystem error — a missing file on disk, never an HTTP 404, which arrives as an
`HttpError` with `status: 404`. It answers `boolean` rather than narrowing to `NodeJS.ErrnoException`,
which would put `@types/node` on every consumer's dependency list. `errorMessage(value)` reads a
message off an unknown throw.

### Auth

`oauthLogin(input, deps)` runs the loopback-redirect authorization-code flow with PKCE and returns
an `OAuthCredential`. `refreshOAuthCredential` exchanges the rotating refresh token;
`revokeOAuthCredential` revokes both tokens server-side and reports whether the server advertised a
revocation endpoint. Types: `Credential` (the `ApiKeyCredential | OAuthCredential` union),
`OAuthLoginInput`, `OAuthLoginDeps`.

### Versions and requirements

`probeServer(client)` reads `/api/session/properties` and returns a `ServerInfo` — the parsed version tag, the edition the tag stamps, the build date and hash, and the token-feature map, each `null` when the server does not report it. `ParsedVersion` is the `{ tag, major, patch }` schema a probed version tag parses to; `editionFromTag(tag)` reads the `Edition` (`"oss"` | `"ee"`) Metabase stamps into the tag's leading number (`v0.` / `v1.`, a hotfix's fourth number and a `-SNAPSHOT` suffix included), `null` when the tag carries none.

`createServerProfile(info)` turns a `ServerInfo` into the `ServerProfile` the client reasons with: the raw facts (`version`, `buildDate`, `hash`, `edition`, `tokenFeatures`), the derived `features`, and `skew` (`Skew`) — `"supported"` inside `KNOWN_RANGE` (`{ min, max }`, the majors the client is built against), `"older-than-known"` below it (the server keeps its real major and is refused feature by feature), `"newer-than-known"` above it, `"unknown"` when the tag did not parse. A newer or unparseable server is evaluated as `KNOWN_RANGE.max + 1`; the edition of a server whose tag carries none is `"ee"` when any premium feature is granted and `"oss"` otherwise. `client.server()` returns the profile passed as `ClientOptions.server`, or probes once on first call and shares the result; `getServerTag` defaults to the tag of whichever profile the client holds — the one passed in, or the one a probe has settled on — so a shape error names the server whenever the client has met it. There is no option to assume a version.

`Features` is a record of named booleans over `FEATURE_RULES`, the one table that relates a behaviour to the majors and token feature it needs (`FeatureRule`: `{ since, until?, tokenFeature? }`); `evaluateFeatures(effectiveMajor, tokenFeatures)` evaluates it, `FEATURE_NAMES` lists the keys, and `isFeatureName` narrows a string to one. Names describe behaviour (`transformTargetTableId`, `libraryChildrenCarryType`), never a version. Consumers branch on a feature, never on a major — `features.ts` is the only module that compares one.

`METHOD_REQUIREMENTS` names, per client method (`"transform.get"`, `"gitSync.branches"` — the `MethodKey` as the method is reached on the client), the features it needs, strictest first; `methodRequirements(key)` reads one entry, `METHOD_KEYS` lists the keys, and `isMethodKey` narrows a string to one. Every resource method starts by asking `transport.require(key)`, which throws a `CapabilityError` before any request leaves when the connected profile lacks a feature — a version gate reads `This operation requires Metabase v59+ (this server is v0.58.0). Upgrade Metabase to use it.`, a token gate `This operation requires the 'remote_sync' premium feature (not enabled on this server).` — and the error's `developerDetail` is a `RequirementFailure` carrying `reason`, `detail`, `feature`, `since`, `tokenFeature` and `serverVersion` — a Zod schema as well as a type (with `RequirementReason` for its `reason` enum), so a consumer that reports the refusal in its own output can describe it. A method that needs nothing never consults the server; a newer or unparseable server is placed past the newest known major, so only a token can refuse it. `ClientOptions.enforceRequirements: false` sends every method to the wire and leaves the server to answer for itself; a method whose wire shape is chosen by generation still reads the profile. `checkFeatures(features, profile)` is the check itself, over any feature list (`methodRequirements(key)` gives a method's), `featureGap(profile, feature)` says which half of a rule the profile fails (`FeatureGap`: `{ kind: "version" }` or `{ kind: "token", tokenFeature }`), and `ruleGap` is the same question asked of a bare rule. A consumer that anticipates the refusal — a CLI preflight, say — throws the same `CapabilityError` from the same `RequirementFailure`.

A resource whose wire shape differs between generations exports from its `@metabase/client/domain/<r>` module, beside the canonical schema, a reader that picks the exact schema for a `Features` and converts forward: `transformDetailSchema(features)` and `transformRowSchema(features)` read a `Transform` (the older generations' hydrated `table` on the detail endpoint, and no link on the rest, become `target_table_id`), `transformJobSchema(features)` reads a `TransformJob` whose `active` is `null` on a generation that cannot switch jobs off, `transformJobRunResultSchema(features)` reads a `TransformJobRunResult` (`{ message, started, run_id }` — a stub id is `started: null, run_id: null`, the request accepted and the outcome unsaid; a numeric or null id is `started: id !== null, run_id: id`), and `libraryWireSchema(features)` with `toLibrary(wire, listing)` reads a `Library` whose `LibraryChild` entries carry `type` from the wire where the generation sends it and `is_remote_synced` from the collection listing on every generation (`LibraryCollectionInfo`, `LibraryListing`). Each `null` in a canonical field means "this server cannot say". `ResponseShapeError.developerDetail.serverSkew` carries the profile's `skew`, and a `newer-than-known` server is named as such in the message's lead line.

Types: `ServerInfo`, `ServerProfile`, `Skew`, `Edition`, `FeatureName`, `FeatureRule`, `Features`, `FeatureGap`, `VersionGap`, `TokenGap`, `MethodKey`, `RequirementFailure`, `RequirementReason`.

### Resource schemas

Every Metabase resource exports a full schema and a compact projection: `Card`/`CardCompact`,
`Collection`/`CollectionCompact`, `Dashboard`/`DashboardCompact`, `Database`/`DatabaseCompact`,
`Document`, `Field`, `FieldValues`, `Glossary`, `Library`, `Measure`, `ModerationReview`, `Notification`,
`ParameterValues`, `Pulse`, `SearchResult`, `Segment`, `Setting`, `Snippet`, `Table`, `Timeline`,
`TimelineEvent`, `Transform`, `TransformRun`, `TransformRunSummary`, `TransformMemberRun`, `TransformJob`,
`TransformTag`, `ReplacementRun`, `Revision`, `TableForeignKey`, `MetricDimension`, `CurrentUser`,
`CardQueryResult`, `EidTranslateResult`, `SetupResult`, `SyncTask`, `SyncDirtyItem`, `DashboardTab`, and
the nested shapes they compose (`Dashcard`, `CollectionItem`, `PulseChannel`, `NotificationHandler`, …).

The full schema is `.loose()`, so server-side additions do not break parsing. The compact projection
is `.pick(…).strip()` — the agent-facing contract, and the shape list commands render. Schemas carry
what drives query writing and content selection; sync flags, fingerprints, and timestamps are
deliberately absent.

A second class of schema describes a single response shape that has no compact pair:
`DashboardDetail`, `DatabaseSyncResult`, `CollectionTreeNode`, `FieldSummary`, `SettingValue`,
`TableQueryMetadata`, `QueryMetadata`, `CompiledQuery`, `SessionProperties`, `TokenFeatures`, a revision's
`RevisionRow` and `RevisionRevert`, the source replacement's `ReplacementCheck` and `ReplacementRunStarted`,
a metric's `MetricBreakoutValues` and `MetricDimensionListing`, the data permissions' `PermissionsGraph`
(a `DatabasePermissions` per group and database, each key left out at its least permissive value), the
dependency graph's `DependencyGraph`, `DependencyNode`, `DependencyEntity`, `BreakingSource`, and
`DependencyFindingError`, the entity relationship diagram's `Erd`, `ErdNode` and `ErdField`, the transform
inspector's `TransformInspection` and `TransformLens`, a DAG run's `TransformDagRunResult` and
`TransformDagTransform`, the Python runner's `PythonLibrary` and `PythonTestRunResult`, and git-sync's
`SyncExportPreflight`.

Request bodies (`<Resource>CreateInput`, `<Resource>UpdateInput`, and `MetricDefinition`, the expression
over metric and measure leaves that `metric.query` and `metric.breakoutValues` run) and the domain vocabulary enums
(`FieldBaseType`, `SearchModel`, `CollectionItemModel`, …) live in the same modules and are reached
at `@metabase/client/domain/<resource>`.

### Utilities

`Page<T>` is `{ items: T[], total: number | null }`, one page of a paged resource method's walk —
`total` is the server's count when the endpoint reports one. `PaginateOptions` carries `query`,
`pageSize` (default 50, Metabase's own server default), `offset`, `max`, and `signal`; a paged
method's own options type is that one minus the `query` it builds itself. Both come from
`@metabase/client/paginate`, alongside the `paginatePages(client, path, itemSchema, opts)` walk the
methods are built on.

`pollUntil(fn, done, opts)` is the only wait loop. `parseJson(text, schema, opts)` is the only
`JSON.parse`. `normalizeUrl`, `displayUrl`, and `assertEndpointOrigin` are the URL helpers; base URLs
may carry a subpath, so request paths are joined by concatenation and an instance URL is never
reduced to its origin.
