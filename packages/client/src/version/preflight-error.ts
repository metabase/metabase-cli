import { MetabaseError } from "../errors";

import type { PreflightFailure } from "./capabilities";

export class CapabilityError extends MetabaseError {
  readonly category = "capability";
  readonly isRetryable = false;
  readonly developerDetail: PreflightFailure;

  constructor(failure: PreflightFailure) {
    super(failure.detail);
    this.name = "CapabilityError";
    this.developerDetail = failure;
  }
}
