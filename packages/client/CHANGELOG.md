# Changelog

Notable changes to `@metabase/client`.

## 0.1.4

- `session.properties` reads the session properties afresh: the settings the caller may read, the server's version among them, and the premium features its license grants. The read is the client's probe, so its answer becomes the profile in force and reaches `onServerProbed`.

## 0.1.3

- `dataAction.create` creates an implicit action on a table as well as a query action. `DataActionCreateInput` is a union on `type`: a `"query"` body takes `dataset_query`, an `"implicit"` one takes `kind` (`ImplicitActionKind`, on the barrel) and `table_id`. Neither takes `database_id`, which the server derives from the query.
- `DataActionUpdateInput` patches a query action's `dataset_query` or an implicit action's `kind` and `table_id`, never both, and takes no `database_id`. `dataAction.update` refuses a `table_id` before the request on a server without `dataActionsWithoutModel`, which would drop it unread; `DATA_ACTION_TABLE_GATE` records the gate.
- `DataAction` and `DataActionCompact` read an implicit action's `kind` and `table_id`.
- `DataActionExecuteResult` reads an implicit action's `rows-updated`, `rows-deleted` or `created-row`, and `rows-affected` is optional.

## 0.1.2

- `oauthLogin` takes an optional `signal`. Aborting it, before or during the flow, rejects with the signal's reason when that is a `MetabaseError`, else with an `AbortError` carrying its message, frees the loopback callback port at once, and cancels discovery, client registration or the token exchange in flight. `tryDiscoverMetadata`, `discoverLoginMetadata`, `registerClient` and `exchangeCode` on `@metabase/client/http/oauth` take a signal too, and `@metabase/client/signal` exports `whenAborted`.

## 0.1.1

- `DashboardCreateInput` holds only the fields `POST /api/dashboard` reads, so a layout passed to `dashboard.create` fails to compile; send it as a `DashboardLayoutInput` through `dashboard.update`. At run time `dashboard.create` drops any other key before the request, as the server does, and refuses a blank `name`, as the server does.
- `DashboardLayoutInput` and `DatabaseUpdateInput` are on the barrel.
- `@metabase/client/json-pointer` exports `unescapeJsonPointerSegment`, the inverse of `escapeJsonPointerSegment`.
- `@metabase/client/version/input-gates` exports the input gates recorded on feature-gated body fields, with `gateTriggered` and `inputGatesOf`, and `featureAvailability` says which servers hold a feature.
- `dataAction.update` refuses a `collection_id` before the request on a server without `dataActionCollections`, which would drop it unread.
- `dashboard.get` and `dashboard.update` read a dashboard holding a text, heading or other dashcard bound to no card. The server answers a stub `card` such as `{ query_average_duration: null, download_perms: "none" }` for such a dashcard, which 0.1.0 refused; it reads as `null`, and `dashboardDetailSchema` on the dashboard subpath is the reader.
- A transform's Python `source-tables` entry reads without `database_id` or `schema`, as the server stores an entry whose table or database is gone. `TransformSourceTableEntry` is the stored entry, and `TransformSourceTableEntryInput`, on the barrel, is the entry the create, update and Python test-run bodies take, as strict as before.
- Every transform read on Metabase 59 accepts a Python transform, whose `source-tables` that server keys by alias. `transformRowSchema` and `transformDetailSchema` read it as the list later servers answer, taking each alias from its key; an entry naming its table by id alone reads `database_id`, `schema` and `table` as `null`, and one whose table that server could not find reads `table_id` as `null` too. `transformSourceTablesAsList` is the feature.
- The dependency readers accept the action nodes Metabase 65 adds: `DependencyType` and `DependencyUsageType` take `"action"`, and `DependencyEntityData.type` takes an action's `"implicit"` or `"query"`. `dependency.graph`, `dependency.dependents` and `dependency.broken` explain an older server's refusal of an action as the entity through `actionDependencyGraph`.
- `notification.get`, and the `update`, `archive` and `send` that read through it, refuse a dashboard subscription with the "not a question alert" `ConfigError` instead of a shape error on its payload. `AnyNotification` is the reader: a question alert in full, any other type read no further than `id` and `payload_type`. `CARD_PAYLOAD_TYPE` has the literal type `"notification/card"`.
- `CurrentUser.email` is any string, so `user.current` reads an account whose address Metabase accepts and a stricter email check refuses, such as one with `!` or `/` in the local part or a digit or one-letter top-level domain.
- `transform.create`, `transform.update` and `transformPython.testRun` send a Python source's tables keyed by alias to Metabase 58 and 59, which read no list: a transform entry as its reference less `alias`, which 59 reads and 58, taking only table ids, refuses, or as the bare table id when it names its table by id alone, and a test-run entry as its table id. `TransformSourceTableEntryInput` also takes that id-only entry, `{ alias, table_id }` with `database_id`, `schema` and `table` absent or `null`, so a transform read from 59 updates back unchanged. `pythonTestRun` holds from 58 on a server licensed for Python transforms.
- `SetupInput.user.email` is any string, so `setup.create` hands Metabase an address it accepts and a stricter email check refuses, and the server judges it.
- `collection.itemPages` walks the `trash` alias on every server. No Metabase routes `/api/collection/trash/items`, so the walk reads the trash collection's id from `GET /api/collection/trash` first and pages its items by that id.
- `search.query` and `collection.itemPages` explain an older server's 400 for a `models` value it does not take as the feature it lacks: `measure` in search through `measures`, `transform` through `transforms`, `exploration` through the new `explorations`, and among collection items `measure` through the new `collectionItemMeasures`.
- `collection.itemPages` applies `pinned_state` on Metabase 64 and later, which read it as `pinned-state` and drop the spelling 58 through 63 read.
- `TransformJobUpdateInput.active` records that it needs `transformJobActivation`; a server before 61 drops it unread and still answers the job as active.
- `LibraryPublishTablesInput.collection_id` records that only a server with `tablePublishTargetCollection` (62+) reads it; an older one publishes into its one Library data collection. It is sent on every server.

## 0.1.0

The first published release: the whole surface.
