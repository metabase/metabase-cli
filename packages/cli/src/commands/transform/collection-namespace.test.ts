import { assert, describe, expect, it } from "vitest";

import { ConfigError } from "../../core/errors";
import { HttpError } from "../../core/http/errors";

import { enrichTransformCollectionError } from "./collection-namespace";

function httpError(status: number, message: string): HttpError {
  return new HttpError({
    status,
    statusText: "Bad Request",
    method: "POST",
    url: "http://example/api/transform",
    responseHeaders: {},
    rawBody: null,
    overrideUserMessage: message,
  });
}

describe("enrichTransformCollectionError", () => {
  it("appends the create-a-transforms-collection hint to the namespace 400", () => {
    const enriched = enrichTransformCollectionError(
      httpError(
        400,
        "collection_id: A Transform can only go in Collections in the :transforms namespace.",
      ),
    );
    assert(enriched instanceof ConfigError);
    expect(enriched.message).toContain("A Transform can only go in Collections");
    expect(enriched.message).toContain("--namespace transforms");
  });

  it("passes an unrelated http error through unchanged", () => {
    const original = httpError(400, "something else entirely");
    expect(enrichTransformCollectionError(original)).toBe(original);
  });

  it("passes non-http errors through unchanged", () => {
    const original = new Error("boom");
    expect(enrichTransformCollectionError(original)).toBe(original);
  });
});
