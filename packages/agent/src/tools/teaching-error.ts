import { HttpError, type HttpErrorKind, toMetabaseError } from "@metabase/cli/errors";

export class TeachingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeachingError";
  }
}

const HTTP_FIX: Record<HttpErrorKind, string> = {
  "resource-missing":
    "Confirm the id exists with `search`, `browse_data`, or `browse_collection` before retrying.",
  "route-missing": "",
  auth: "The API key lacks permission for this resource — it cannot be retried without broader Metabase access.",
  "rate-limit": "Metabase is rate-limiting; wait before retrying.",
  "server-error":
    "Metabase failed while running this. The body may still be the cause — the query processor throws a 5xx on shapes its request validator lets through — so check it against the skill before retrying. If it is right and this persists, report it.",
  generic: "",
};

const BAD_REQUEST = 400;
const PAYMENT_REQUIRED = 402;
const MAX_BODY_LEN = 2000;
const ELLIPSIS = "…";

// Metabase answers a licensed-feature call on an unlicensed instance with a bare 402 and no body,
// which reads as a transport failure and invites a retry. It is the one status where the fix is not
// in the request at all.
const LICENSE_REQUIRED =
  "This Metabase's license does not include the feature this call needs, so no retry and no change to the request will make it work. Tell the user their instance needs the paid feature enabled.";

export function toTeachingError(error: unknown, bodyFix = ""): TeachingError {
  if (error instanceof TeachingError) {
    return error;
  }
  const metabaseError = toMetabaseError(error);
  if (!(metabaseError instanceof HttpError)) {
    return new TeachingError(metabaseError.userMessage);
  }
  const parts = [metabaseError.userMessage, HTTP_FIX[metabaseError.kind]];
  const bodyMayBeAtFault =
    metabaseError.status === BAD_REQUEST || metabaseError.kind === "server-error";
  if (bodyMayBeAtFault) {
    parts.push(bodyFix, rejectionDetail(metabaseError));
  }
  if (metabaseError.status === PAYMENT_REQUIRED) {
    parts.push(LICENSE_REQUIRED);
  }
  return new TeachingError(parts.filter((part) => part !== "").join(" "));
}

// A rejected body is the one error where the model needs the server's own words: Metabase names the
// offending path, and `buildUserMessage` only surfaces that when the response envelope carries a
// string message. Malli explains do not, and fall back to a bare "Metabase returned 400."
function rejectionDetail(error: HttpError): string {
  const body = error.developerDetail.body?.trim();
  if (body === undefined || body === "" || body.includes(error.userMessage)) {
    return "";
  }
  return `Metabase responded: ${capLength(body)}`;
}

function capLength(body: string): string {
  if (body.length <= MAX_BODY_LEN) {
    return body;
  }
  return body.slice(0, MAX_BODY_LEN - ELLIPSIS.length) + ELLIPSIS;
}
