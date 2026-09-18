import { type ErrorCategory, MetabaseError } from "@metabase/client/errors";

// A refusal or shape error raised under a cached profile that a fresh probe has since rewritten.
// The note is the CLI's own, so it rides on the message and leaves the client's detail as it was.
export class ProfileRefreshedError extends MetabaseError {
  readonly category: ErrorCategory;
  readonly isRetryable = false;
  readonly developerDetail: unknown;

  constructor(cause: MetabaseError, note: string) {
    super(`${cause.userMessage}\n${note}`);
    this.name = "ProfileRefreshedError";
    this.category = cause.category;
    this.developerDetail = cause.developerDetail;
  }
}
