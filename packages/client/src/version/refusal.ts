import { InternalError } from "../errors";
import { FIELD_PATH_SEPARATOR, HttpError } from "../http/errors";
import type { Transport } from "../http/transport";

import { BAD_REQUEST_STATUS, type RequirementFailure } from "./capability-error";
import type { ServerProfile } from "./profile";
import {
  type CallRequirement,
  callFeatures,
  checkFeatures,
  type ParameterRequirement,
} from "./requirement-check";
import { isMethodKey, type MethodKey, methodRequirements } from "./requirements";

const PAYMENT_REQUIRED_STATUS = 402;
const NOT_FOUND_STATUS = 404;

// What a server answers for what it does not serve: unrouted, a verb the route lacks included
// (404); the premium refusal, which a gated prefix answers before routing (402); and a 400 for a
// value or a body shape an older route does not take. A 400 is also an ordinary validation failure,
// so it is the feature's refusal only when nothing in it points elsewhere.
const REFUSAL_STATUSES: ReadonlySet<number> = new Set([
  BAD_REQUEST_STATUS,
  PAYMENT_REQUIRED_STATUS,
  NOT_FOUND_STATUS,
]);

// The features a call needs only because of the arguments it was handed, where a server without
// them rejects the request rather than dropping the argument.
export type ParameterFeatures<A extends unknown[]> = (
  ...args: A
) => readonly ParameterRequirement[];

type NamespaceOf<K> = K extends `${infer N}.${string}` ? N : never;
type MethodNamespace = NamespaceOf<MethodKey>;
type NameIn<K, N extends string> = K extends `${N}.${infer M}` ? M : never;
type MethodName<N extends MethodNamespace> = NameIn<MethodKey, N>;

// Wraps one resource's gated methods as the client exposes them: the server decides whether the
// call is allowed, and a refusal it answers with reads as the feature it lacks. `explain` wraps a
// method answering a promise, `explainWalk` one answering an async iterable, whose failure at any
// step is explained as it is thrown. The method alone sets the exposed signature, so `parameters`
// is `NoInfer`: a callback reading fewer arguments must not drop the rest from it.
export function explainer<N extends MethodNamespace>(transport: Transport, namespace: N) {
  function explain<A extends unknown[], R>(
    name: MethodName<N>,
    method: (...args: A) => Promise<R>,
    parameters?: NoInfer<ParameterFeatures<A>>,
  ): (...args: A) => Promise<R> {
    const key = methodKey(namespace, name);
    return async (...args) => {
      try {
        return await method(...args);
      } catch (error) {
        throw await transport.explainRefusal(callRequirement(key, parameters, args), error);
      }
    };
  }

  function explainWalk<A extends unknown[], T>(
    name: MethodName<N>,
    method: (...args: A) => AsyncIterable<T>,
    parameters?: NoInfer<ParameterFeatures<A>>,
  ): (...args: A) => AsyncIterable<T> {
    const key = methodKey(namespace, name);
    return async function* (...args) {
      try {
        yield* method(...args);
      } catch (error) {
        throw await transport.explainRefusal(callRequirement(key, parameters, args), error);
      }
    };
  }

  return { explain, explainWalk };
}

function methodKey(namespace: string, name: string): MethodKey {
  const key = `${namespace}.${name}`;
  if (!isMethodKey(key)) {
    throw new InternalError(`no requirements entry for ${key}`);
  }
  return key;
}

function callRequirement<A extends unknown[]>(
  key: MethodKey,
  parameters: ParameterFeatures<A> | undefined,
  args: A,
): CallRequirement {
  const brought = parameters === undefined ? [] : parameters(...args);
  return { parameters: brought, method: methodRequirements(key) };
}

/**
 * Whether `error` may be the server refusing `call` for a feature it lacks. A call that needs no
 * feature cannot be, and neither can a 404 for a missing row, which comes from a route the server
 * serves.
 */
export function mayBeRefusal(call: CallRequirement, error: unknown): error is HttpError {
  if (callFeatures(call).length === 0) {
    return false;
  }
  if (!(error instanceof HttpError) || error.kind === "resource-missing") {
    return false;
  }
  return REFUSAL_STATUSES.has(error.status);
}

/**
 * The feature `profile` lacks that explains `refusal` of `call`, or `null` when the server has every
 * feature the call needs, so it failed for some other reason, or when the refusal points elsewhere.
 */
export function explainedFailure(
  call: CallRequirement,
  profile: ServerProfile,
  refusal: HttpError,
): RequirementFailure | null {
  const failure = checkFeatures(callFeatures(call), profile);
  if (failure === null || pointsElsewhere(call, profile, refusal)) {
    return null;
  }
  return failure;
}

// A 400 names the fields it rejected, and one naming a field the missing parameter features do not
// gate rejected the call for that field: an argument needing a feature the server lacks rode along
// with a value the server refuses anyway. A server lacking a feature the method itself needs cannot
// serve the call whatever field it names, so nothing points elsewhere; nor does a 400 that names no
// field at all.
function pointsElsewhere(
  call: CallRequirement,
  profile: ServerProfile,
  refusal: HttpError,
): boolean {
  if (refusal.status !== BAD_REQUEST_STATUS || checkFeatures(call.method, profile) !== null) {
    return false;
  }
  const named = rejectedFields(refusal);
  const gated = new Set(
    call.parameters
      .filter((parameter) => checkFeatures([parameter.feature], profile) !== null)
      .flatMap((parameter) => parameter.fields),
  );
  return named.some((field) => !gated.has(field));
}

// The top-level request field of every rejection the server listed; a nested one is keyed by its
// dot-joined path.
function rejectedFields(refusal: HttpError): string[] {
  return [refusal.fieldErrors, refusal.specificFieldErrors].flatMap((errors) =>
    errors === null ? [] : Object.keys(errors).map(topLevelField),
  );
}

function topLevelField(path: string): string {
  const end = path.indexOf(FIELD_PATH_SEPARATOR);
  return end === -1 ? path : path.slice(0, end);
}
