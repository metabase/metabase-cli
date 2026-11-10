// What an error keeps of the body it was answered with, as text. The whole body can run to
// megabytes (a stack trace, a list repeated under every cause), and this much is enough to quote.
export const ERROR_BODY_BYTE_CAP = 64 * 1024;

// The JSON a failure's whole body parsed to, already redacted. It is held beside the error rather
// than on it: the error's own detail stays the capped text, which is what gets printed and
// serialized, while a resource reading a refusal longer than the cap still reads every item.
const BODY_JSON = new WeakMap<object, unknown>();

export function keepErrorBodyJson(error: object, json: unknown): void {
  BODY_JSON.set(error, json);
}

// `null` when the body was not JSON.
export function errorBodyJson(error: object): unknown {
  return BODY_JSON.get(error) ?? null;
}
