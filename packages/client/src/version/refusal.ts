import type { ZodType } from "zod";

import type { SessionProperties } from "../domain/session-properties";
import { InternalError, isNonInterruptFailure } from "../errors";
import {
  BAD_REQUEST_STATUS,
  FIELD_PATH_SEPARATOR,
  HttpError,
  NOT_FOUND_STATUS,
  PAYMENT_REQUIRED_STATUS,
} from "../http/errors";
import type { RequestOptions, Transport, WaitOptions } from "../http/transport";
import { isPlainObject } from "../predicates";

import { CapabilityError, type RequirementFailure } from "./capability-error";
import type { FeatureName } from "./features";
import { profileFromProperties } from "./probe";
import type { ServerProfile } from "./profile";
import { checkFeatures, featureFailures } from "./requirement-check";
import { isMethodKey, type MethodKey, methodRequirements } from "./requirements";

// What a server answers for what it does not serve: unrouted, a verb the route lacks included
// (404); the premium refusal, which a gated prefix answers before routing (402); and a 400 for a
// value or a body shape an older route does not take. A 400 is also an ordinary validation failure,
// so it is the feature's refusal only when nothing in it points elsewhere.
const REFUSAL_STATUSES: ReadonlySet<number> = new Set([
  BAD_REQUEST_STATUS,
  PAYMENT_REQUIRED_STATUS,
  NOT_FOUND_STATUS,
]);

// A feature a call needs only because of an argument it was handed, with the request fields that
// argument travels in, as a server rejecting it names them.
export interface ParameterRequirement {
  readonly feature: FeatureName;
  readonly fields: readonly string[];
}

// What one call needs from the server: the features its arguments brought, then the method's own.
export interface CallRequirement {
  readonly parameters: readonly ParameterRequirement[];
  readonly method: readonly FeatureName[];
}

// The features a call needs only because of the arguments it was handed, where a server without
// them rejects the request rather than dropping the argument.
export type ParameterFeatures<A extends unknown[]> = (
  ...args: A
) => readonly ParameterRequirement[];

// A method's arguments, ending in the `RequestOptions` a caller may leave out.
type WithOptions<A extends unknown[]> = [...A, options?: RequestOptions | undefined];

type NamespaceOf<K> = K extends `${infer N}.${string}` ? N : never;
type MethodNamespace = NamespaceOf<MethodKey>;
type NameIn<K, N extends string> = K extends `${N}.${infer M}` ? M : never;
type MethodName<N extends MethodNamespace> = NameIn<MethodKey, N>;

// Wraps one resource's gated methods as the client exposes them: the server decides whether the
// call is allowed, and a refusal it answers with reads as the feature it lacks. `explain` wraps a
// method answering a promise, `explainWalk` one answering an async iterable, whose failure at any
// step is explained as it is thrown. The method alone sets the exposed signature, so `parameters`
// is `NoInfer`: a callback reading fewer arguments must not drop the rest from it. `refuse` wraps
// the exception, a method a server without its features would answer wrongly without a word: the
// call is refused before the request, against a profile the client probed itself, and the server
// never gets to refuse it, unless the caller skips such refusals, which the transport's
// `refuseBeforeSending` decides. `refuseAfterReading` wraps such a method answering from the
// session properties alone, which it is handed read afresh.
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
        throw await explainRefusal(transport, callRequirement(key, parameters, args), error);
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
        throw await explainRefusal(transport, callRequirement(key, parameters, args), error);
      }
    };
  }

  // The wait for the profile ends with the signal the call's trailing `RequestOptions` carries, as
  // the call's own requests do.
  function refuse<A extends unknown[], R>(
    name: MethodName<N>,
    method: (...args: WithOptions<A>) => Promise<R>,
  ): (...args: WithOptions<A>) => Promise<R> {
    const key = methodKey(namespace, name);
    return async (...args: WithOptions<A>) => {
      await transport.requireFeatures(methodRequirements(key), trailingWait(args));
      return method(...args);
    };
  }

  // The read is a probe of the call's own, never an older one settled, so a setting changed since
  // is seen. The refusal judges the profile that same answer describes, not whichever probe is
  // newest by the time it asks, so the call costs one request however other calls interleave. The
  // call takes nothing but the options, so they never need telling apart from an argument of the
  // method's own, and their budget is the read's. The read is also the method's own data, so a
  // failed read fails the call even when the caller skips checks before the wire.
  function refuseAfterReading<P extends SessionProperties, R>(
    name: MethodName<N>,
    reader: ZodType<P>,
    method: (properties: P) => R,
  ): (options?: RequestOptions) => Promise<R> {
    const key = methodKey(namespace, name);
    return async (options: RequestOptions = {}) => {
      const properties = await transport.probe(reader, options);
      const profile = profileFromProperties(properties);
      for (const failure of featureFailures(methodRequirements(key), profile)) {
        transport.refuseBeforeSending(new CapabilityError(failure));
      }
      return method(properties);
    };
  }

  return { explain, explainWalk, refuse, refuseAfterReading };
}

// The options are the last argument whenever a caller passes them; left out, the last argument is
// one of the method's own, and none of those carries an abort signal.
function trailingWait(args: readonly unknown[]): WaitOptions {
  const last = args.at(-1);
  if (isPlainObject(last) && last["signal"] instanceof AbortSignal) {
    return { signal: last["signal"] };
  }
  return {};
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
 * The error a call failed with, as a `CapabilityError` carrying the server's answer when the server
 * refused it for lacking one of the features `call` needs, and unchanged otherwise. The server's own
 * refusal is the verdict; the profile only names what was missing. The explaining probe is bounded
 * by its own timeout and the client's signal; the error stands when the probe fails, and an
 * interrupt surfaces as one.
 */
export async function explainRefusal(
  transport: Pick<Transport, "verifiedServer">,
  call: CallRequirement,
  error: unknown,
): Promise<unknown> {
  if (!mayBeRefusal(call, error)) {
    return error;
  }
  let profile: ServerProfile;
  try {
    profile = await transport.verifiedServer();
  } catch (probeError) {
    if (isNonInterruptFailure(probeError)) {
      return error;
    }
    throw probeError;
  }
  const failure = explainedFailure(call, profile, error);
  return failure === null ? error : new CapabilityError(failure, error);
}

/** Every feature `call` needs, parameters first, since a parameter's floor sits above its method's. */
function callFeatures(call: CallRequirement): FeatureName[] {
  return [...call.parameters.map((parameter) => parameter.feature), ...call.method];
}

/**
 * Whether `error` may be the server refusing `call` for a feature it lacks. A call that needs no
 * feature cannot be, and neither can a 404 for a missing row, which comes from a route the server
 * serves.
 */
function mayBeRefusal(call: CallRequirement, error: unknown): error is HttpError {
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
function explainedFailure(
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
