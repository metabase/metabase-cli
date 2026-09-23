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
export { Edition, editionFromTag, ParsedVersion } from "./version/tag";
export {
  evaluateFeatures,
  FEATURE_NAMES,
  FEATURE_RULES,
  Features,
  isFeatureName,
  ruleGap,
} from "./version/features";
export type {
  FeatureGap,
  FeatureName,
  FeatureRule,
  TokenGap,
  VersionGap,
} from "./version/features";
export { KNOWN_RANGE } from "./version/known-range";
export { createServerProfile, featureGap, ServerProfile, Skew } from "./version/profile";
export {
  isMethodKey,
  METHOD_KEYS,
  METHOD_REQUIREMENTS,
  methodRequirements,
} from "./version/requirements";
export type { MethodKey } from "./version/requirements";
export { checkFeatures } from "./version/requirement-check";
export { CapabilityError, RequirementFailure, RequirementReason } from "./version/preflight-error";

export type { Page, PaginateOptions } from "./paginate";
export { pollUntil } from "./poll";
export type { Backoff, PollOptions } from "./poll";
export { parseJson } from "./json";
export type { ParseJsonOptions } from "./json";
export { assertEndpointOrigin, displayUrl, normalizeUrl } from "./url";

export {
  Database,
  DatabaseCompact,
  DatabaseGetInclude,
  DatabaseListInclude,
} from "./domain/database";
export {
  Field,
  FieldBaseType,
  FieldCompact,
  FieldSemanticType,
  FieldValues,
  FieldValuesCompact,
} from "./domain/field";
export {
  isSyncTaskFailed,
  isSyncTaskTerminal,
  SyncImportResult,
  SyncTask,
  SyncTaskCompact,
  SyncTaskStatus,
  SyncTaskType,
} from "./domain/git-sync";
export { SessionProperties, TokenFeatures } from "./domain/session-properties";
export { Table, TableCompact, TableVisibilityType } from "./domain/table";
export { CurrentUser, CurrentUserCompact } from "./domain/user";
