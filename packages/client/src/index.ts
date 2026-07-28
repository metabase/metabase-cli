export { createClient } from "./client";
export type { MetabaseClient } from "./client";
export { createTransport } from "./http/transport";
export type {
  Transport,
  ClientCredentials,
  ClientOptions,
  ExpectedContentType,
  HttpMethod,
  QueryValue,
  RequestOptions,
  ServerTagResolver,
  TransportRequestOptions,
} from "./http/transport";
export type { ListResult } from "./list";

export { HttpError, isHttpNotFound } from "./http/errors";
export type { FieldErrors, HttpErrorDetail, HttpErrorKind } from "./http/errors";
export {
  AbortError,
  ChainedRequestError,
  ConfigError,
  errorMessage,
  InternalError,
  isFileNotFoundError,
  MetabaseError,
  NetworkError,
  ResponseShapeError,
  TimeoutError,
  toMetabaseError,
  UnknownError,
  ValidationError,
} from "./errors";
export type {
  DecodedResponseShapeDetail,
  ErrorCategory,
  HttpTimeoutDetail,
  NetworkErrorDetail,
  PollingTimeoutDetail,
  ResponseShapeErrorDetail,
  TimeoutErrorDetail,
  UnknownErrorDetail,
  ValidationErrorDetail,
  ZodResponseShapeDetail,
} from "./errors";

export { oauthLogin } from "./auth/oauth-login";
export type { OAuthLoginDeps, OAuthLoginInput } from "./auth/oauth-login";
export { refreshOAuthCredential, revokeOAuthCredential } from "./auth/oauth-session";
export type {
  ApiKeyCredential,
  Credential,
  CredentialRefresher,
  OAuthCredential,
} from "./auth/credential";

export { probeServer } from "./version/probe";
export type { ServerInfo } from "./version/probe";
export { ParsedVersion } from "./version/tag";
export {
  BASELINE_CAPABILITIES,
  Capabilities,
  checkCapabilities,
  mergeCapabilities,
} from "./version/capabilities";
export type { PreflightFailure } from "./version/capabilities";
export { CapabilityError } from "./version/preflight-error";

export type { Page, PaginateOptions } from "./paginate";
export { pollUntil } from "./poll";
export type { Backoff, PollOptions } from "./poll";
export { parseJson } from "./json";
export type { ParseJsonOptions } from "./json";
export { assertEndpointOrigin, displayUrl, normalizeUrl } from "./url";

export {
  Card,
  CardCompact,
  CardCreateInput,
  CardDatasetQuery,
  CardExportFormat,
  CardListFilter,
  CardQueryResult,
  CardQueryResultCompact,
  CardUpdateInput,
} from "./domain/card";
export {
  COLLECTION_ITEM_FILTER_MODELS,
  COLLECTION_ITEM_MODELS,
  COLLECTION_PINNED_STATES,
  Collection,
  CollectionCompact,
  CollectionCreateInput,
  CollectionId,
  CollectionItem,
  CollectionItemCompact,
  CollectionItemFilterModel,
  CollectionItemModel,
  CollectionListFilter,
  CollectionNamespace,
  CollectionPinnedState,
  CollectionTreeNode,
  CollectionUpdateInput,
} from "./domain/collection";
export { CronUiDisplayType } from "./domain/cron";
export {
  Dashboard,
  DashboardCompact,
  DashboardCreateInput,
  DashboardDetail,
  DashboardListFilter,
  DashboardTab,
  DashboardTabCompact,
  DashboardUpdateInput,
  Dashcard,
  DashcardCompact,
  DashcardPatchInput,
} from "./domain/dashboard";
export {
  Database,
  DatabaseCompact,
  DatabaseGetInclude,
  DatabaseListInclude,
  DatabaseSyncResult,
} from "./domain/database";
export {
  Document,
  DocumentCompact,
  DocumentCreateInput,
  DocumentUpdateInput,
  TipTapNode,
  TipTapNodeInput,
} from "./domain/document";
export {
  EID_MODELS,
  EidModel,
  EidTranslateEntry,
  EidTranslateInput,
  EidTranslateResult,
  EidTranslateResultCompact,
} from "./domain/eid-translation";
export { EmbeddingParams } from "./domain/embedding";
export {
  Field,
  FieldBaseType,
  FieldCoercionStrategy,
  FieldCompact,
  FieldSemanticType,
  FieldSummary,
  FieldUpdateInput,
  FieldValues,
  FieldValuesCompact,
} from "./domain/field";
export {
  isSyncTaskFailed,
  isSyncTaskTerminal,
  SyncBranchCreated,
  SyncDirtyItem,
  SyncDirtyItemCompact,
  SyncExportResult,
  SyncImportResult,
  SyncRemoteChanges,
  SyncSettingsUpdateResult,
  SyncStashResult,
  SyncTask,
  SyncTaskCompact,
  SyncTaskStatus,
  SyncTaskType,
} from "./domain/git-sync";
export { Library, LibraryChild, LibraryCompact } from "./domain/library";
export { Measure, MeasureCompact, MeasureCreateInput, MeasureUpdateInput } from "./domain/measure";
export {
  CARD_PAYLOAD_TYPE,
  Notification,
  NotificationCardPayload,
  NotificationCardPayloadCompact,
  NotificationCardPayloadPatch,
  NotificationChannelType,
  NotificationCompact,
  NotificationCreateInput,
  NotificationHandler,
  NotificationHandlerCompact,
  NotificationPayloadType,
  NotificationRecipient,
  NotificationRecipientCompact,
  NotificationRecipientDetails,
  NotificationRecipientType,
  NotificationSendCondition,
  NotificationSubscription,
  NotificationSubscriptionCompact,
  NotificationSubscriptionType,
  NotificationUpdateInput,
} from "./domain/notification";
export {
  Parameter,
  ParameterMapping,
  ParameterTarget,
  ParameterType,
  ParameterValues,
  ParameterValuesCompact,
  TemporalUnit,
  ValuesQueryType,
  ValuesSourceConfig,
  ValuesSourceType,
} from "./domain/parameter";
export {
  Pulse,
  PulseCard,
  PulseCardCompact,
  PulseChannel,
  PulseChannelCompact,
  PulseChannelDetails,
  PulseChannelType,
  PulseCompact,
  PulseCreateInput,
  PulseRecipient,
  PulseRecipientCompact,
  PulseScheduleDay,
  PulseScheduleFrame,
  PulseScheduleType,
  PulseUpdateInput,
} from "./domain/pulse";
export { SEARCH_MODELS, SearchModel, SearchResult, SearchResultCompact } from "./domain/search";
export { Segment, SegmentCompact, SegmentCreateInput, SegmentUpdateInput } from "./domain/segment";
export { SessionProperties, TokenFeatures } from "./domain/session-properties";
export { Setting, SettingCompact, SettingValue } from "./domain/setting";
export { SetupInput, SetupResult, SetupResultCompact } from "./domain/setup";
export { Snippet, SnippetCompact, SnippetCreateInput, SnippetUpdateInput } from "./domain/snippet";
export {
  Table,
  TableCompact,
  TableGetInclude,
  TableQueryMetadata,
  TableUpdateInput,
} from "./domain/table";
export {
  Timeline,
  TimelineCompact,
  TimelineCreateInput,
  TimelineEvent,
  TimelineEventCompact,
  TimelineEventCreateInput,
  TimelineEventUpdateInput,
  TimelineIcon,
  TimelineUpdateInput,
} from "./domain/timeline";
export {
  isTransformRunFailed,
  isTransformRunTerminal,
  Transform,
  TransformCompact,
  TransformCreateInput,
  TransformRun,
  TransformRunCompact,
  TransformRunResult,
  TransformRunStatus,
  TransformTarget,
  TransformUpdateInput,
} from "./domain/transform";
export {
  TransformIndex,
  TransformIndexCompact,
  TransformIndexCreateInput,
  TransformIndexRequest,
  TransformIndexRequestCompact,
  TransformIndexStructured,
  TransformIndexUpdateInput,
} from "./domain/transform-index";
export {
  TransformJob,
  TransformJobActiveResult,
  TransformJobCompact,
  TransformJobCreateInput,
  TransformJobRunResult,
  TransformJobUpdateInput,
} from "./domain/transform-job";
export {
  TransformTag,
  TransformTagCompact,
  TransformTagCreateInput,
  TransformTagUpdateInput,
} from "./domain/transform-tag";
export { UploadResult, UploadUpdateAction, UploadUpdateResult } from "./domain/upload";
export { CurrentUser, CurrentUserCompact } from "./domain/user";
