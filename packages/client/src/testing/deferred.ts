export interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

// A promise settled from outside, so a test can hold a response back until it has observed what
// happens while it is pending.
function unsettled(): never {
  throw new Error("deferred: executor did not run");
}

export function deferred<T>(): Deferred<T> {
  let settle: (value: T) => void = unsettled;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: (value) => settle(value) };
}
