import { ConfigError } from "../../core/errors";
import { HttpError } from "../../core/http/errors";

const TRANSFORMS_NAMESPACE_HINT =
  'transforms can only be filed in a :transforms-namespace collection. Create one with `mb collection create --body \'{"name":"…"}\' --namespace transforms` and pass its id as collection_id, or omit collection_id to leave the transform uncollected.';

// The server rejects a transform whose collection_id points at a normal (default-namespace)
// collection with a 400 like "collection_id: A Transform can only go in Collections in the
// :transforms namespace." That message is clear but dead-ends — append the command that
// creates a usable collection. Match narrowly so any other 400 falls through unchanged.
export function enrichTransformCollectionError(error: unknown): unknown {
  if (
    error instanceof HttpError &&
    error.status === 400 &&
    /:transforms namespace/i.test(error.message)
  ) {
    return new ConfigError(`${error.message} — ${TRANSFORMS_NAMESPACE_HINT}`);
  }
  return error;
}
