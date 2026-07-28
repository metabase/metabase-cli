# @metabase/client

The Metabase API client behind [`@metabase/cli`](../../README.md). It owns the HTTP boundary, a Zod
schema per Metabase resource, the OAuth login flow, and the server version/capability model.

The package is workspace-internal (`private: true`). `@metabase/cli` consumes it from source and
inlines it at build time via tsdown's `noExternal`, so the published CLI has no runtime dependency
on it.

`tsdown` here emits one ESM module and one declaration file per `exports` entry into `dist/`, and the
map names those rather than the source. Installing the packed tarball therefore gets JavaScript Node
can load and declarations `moduleResolution: node16` can follow, with no `@types/node` required.

## Dependency budget

Runtime dependencies are `zod` and `semver`. `zod` is a **peer** dependency: every schema on this
surface is a zod schema, so the consumer's zod is part of the contract and a resolver must be told to
reconcile the two rather than left free to add a second copy. A production module under `src/` imports
nothing beyond those two and `node:` builtins; test files may reach the root devDependencies.

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

A resource method whose endpoint pages answers an `AsyncIterable<Page<T>>` — `mb.collection.itemPages`
and `mb.transform.runPages` are the two — requesting `limit`/`offset` pages and yielding a `Page<T>`
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
fires first ends the work.

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
`ServerTagResolver`) lets the host name the Metabase version a `ResponseShapeError` reports.

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

### Version and capabilities

`probeServer(client)` reads `/api/session/properties` and returns a `ServerInfo` — the parsed
version tag and the token-feature map, each `null` when the server does not report it.
`checkCapabilities(info, required)` returns a `PreflightFailure` or `null`. `Capabilities` is the
`{ minVersion, tokenFeature? }` schema, `ParsedVersion` the `{ tag, major, patch }` schema a probed
version tag parses to, `BASELINE_CAPABILITIES` the minimum supported server, and `mergeCapabilities`
fills a partial declaration from it. `CapabilityError` is what a caller throws on a failed
preflight. Types: `ServerInfo`, `PreflightFailure`.

### Resource schemas

Every Metabase resource exports a full schema and a compact projection: `Card`/`CardCompact`,
`Collection`/`CollectionCompact`, `Dashboard`/`DashboardCompact`, `Database`/`DatabaseCompact`,
`Document`, `Field`, `FieldValues`, `Library`, `Measure`, `Notification`, `ParameterValues`, `Pulse`,
`SearchResult`, `Segment`, `Setting`, `Snippet`, `Table`, `Timeline`, `TimelineEvent`, `Transform`,
`TransformRun`, `TransformJob`, `TransformTag`, `TransformIndex`, `TransformIndexRequest`,
`CurrentUser`, `CardQueryResult`,
`EidTranslateResult`, `SetupResult`, `SyncTask`, `SyncDirtyItem`, `DashboardTab`, and the nested
shapes they compose (`Dashcard`, `CollectionItem`, `PulseChannel`, `NotificationHandler`, …).

The full schema is `.loose()`, so server-side additions do not break parsing. The compact projection
is `.pick(…).strip()` — the agent-facing contract, and the shape list commands render. Schemas carry
what drives query writing and content selection; sync flags, fingerprints, and timestamps are
deliberately absent.

A second class of schema describes a single response shape that has no compact pair:
`DashboardDetail`, `DatabaseSyncResult`, `CollectionTreeNode`, `FieldSummary`, `SettingValue`,
`TableQueryMetadata`, `SessionProperties`, and `TokenFeatures`.

Request bodies (`<Resource>CreateInput`, `<Resource>UpdateInput`) and the domain vocabulary enums
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
