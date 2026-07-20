import { HttpError, ValidationError } from "@metabase/cli/errors";
import { expect, test } from "vitest";
import { skillsAfterRejection } from "./skill-prereq";
import { TeachingError, toTeachingError } from "./teaching-error";

const MBQL_FIX = skillsAfterRejection(["mbql"]);

// Metabase explains a rejected query body with a Malli explain, whose leaves are not strings — so
// the HTTP layer extracts no message from it and falls back to a bare status line.
const MALLI_EXPLAIN =
  '{"specific-errors":{"dataset_query":{"stages":[{"breakout":[[["should be a map"]]]}]}}}';

function badRequest(rawBody: string): HttpError {
  return new HttpError({
    status: 400,
    statusText: "Bad Request",
    method: "POST",
    url: "https://mb.example/api/card",
    responseHeaders: { "content-type": "application/json" },
    rawBody,
  });
}

test("appends a lookup fix to a resource-missing HTTP error", () => {
  const error = new HttpError({
    status: 404,
    statusText: "Not Found",
    method: "GET",
    url: "https://mb.example/api/card/999",
    responseHeaders: {},
    rawBody: '{"message":"Not found."}',
  });
  const teaching = toTeachingError(error);
  expect(teaching).toBeInstanceOf(TeachingError);
  expect(teaching.message).toBe(
    "Not found: GET /api/card/999. Confirm the id exists with `search`, `browse_data`, or `browse_collection` before retrying.",
  );
});

test("appends a permission fix to an auth HTTP error", () => {
  const error = new HttpError({
    status: 401,
    statusText: "Unauthorized",
    method: "GET",
    url: "https://mb.example/api/card/1",
    responseHeaders: {},
    rawBody: null,
  });
  const teaching = toTeachingError(error);
  expect(teaching.message).toBe(
    "Invalid or unauthorized API key (host: mb.example). The API key lacks permission for this resource — it cannot be retried without broader Metabase access.",
  );
});

test("passes a non-HTTP MetabaseError user message through unchanged", () => {
  const error = new ValidationError("Invalid input.", { source: "body", zodIssues: [] });
  const teaching = toTeachingError(error);
  expect(teaching.message).toBe("Invalid input.");
});

test("returns an existing TeachingError unchanged", () => {
  const original = new TeachingError("id is required for update method");
  expect(toTeachingError(original)).toBe(original);
});

test("names the skill and quotes the response when a rejected body yields no message", () => {
  const teaching = toTeachingError(badRequest(MALLI_EXPLAIN), MBQL_FIX);
  expect(teaching.message).toBe(
    `Metabase returned 400. ${MBQL_FIX} Metabase responded: ${MALLI_EXPLAIN}`,
  );
});

test("does not re-quote a response the HTTP layer already extracted a message from", () => {
  const teaching = toTeachingError(
    badRequest('{"message":"Unrecognized clause :breakouts"}'),
    MBQL_FIX,
  );
  expect(teaching.message).toBe(`Unrecognized clause :breakouts ${MBQL_FIX}`);
});

// Metabase answers a body its request validator accepted but its query processor choked on with a
// 5xx. Telling the model that a 5xx exonerates the body sends it rewriting the parts that were
// never wrong, so the skill fix rides along with the server errors too.
test("hands the model the skill fix on a server error rather than exonerating the body", () => {
  const error = new HttpError({
    status: 500,
    statusText: "Internal Server Error",
    method: "POST",
    url: "https://mb.example/api/card",
    responseHeaders: {},
    rawBody: null,
  });
  const teaching = toTeachingError(error, MBQL_FIX);
  expect(teaching.message).toBe(
    "Metabase returned 500. Metabase failed while running this. The body may still be the cause — " +
      "the query processor throws a 5xx on shapes its request validator lets through — so check it " +
      "against the skill before retrying. If it is right and this persists, report it. " +
      MBQL_FIX,
  );
});

test("surfaces Metabase's own words on a server error", () => {
  const error = new HttpError({
    status: 500,
    statusText: "Internal Server Error",
    method: "POST",
    url: "https://mb.example/api/dataset",
    responseHeaders: { "content-type": "application/json" },
    rawBody: MALLI_EXPLAIN,
  });
  const teaching = toTeachingError(error);
  expect(teaching.message).toContain(`Metabase responded: ${MALLI_EXPLAIN}`);
});

// The e2e stack answers a transform call on an unlicensed instance with exactly this: a bare 402,
// no body. Without the license line it reads as a transport hiccup and invites a retry.
test("a 402 says the license is the blocker, not the request", () => {
  const error = new HttpError({
    status: 402,
    statusText: "Payment Required",
    method: "POST",
    url: "https://mb.example/api/transform",
    responseHeaders: {},
    rawBody: "",
  });

  expect(toTeachingError(error)).toEqual(
    new TeachingError(
      "Metabase returned 402. This Metabase's license does not include the feature this call needs, so no retry and no change to the request will make it work. Tell the user their instance needs the paid feature enabled.",
    ),
  );
});
