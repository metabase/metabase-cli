import type { ExplainOptions, Transport } from "../http/transport";

import type { FeatureName } from "./features";
import { isMethodKey, type MethodKey, methodRequirements } from "./requirements";

// The features a call needs only because of the arguments it was handed, where a server without
// them rejects the request rather than dropping the argument.
export type ParameterFeatures<A extends unknown[]> = (...args: A) => readonly FeatureName[];

type NamespaceOf<K> = K extends `${infer N}.${string}` ? N : never;
type MethodNamespace = NamespaceOf<MethodKey>;
type NameIn<K, N extends string> = K extends `${N}.${infer M}` ? M : never;
type MethodName<N extends MethodNamespace> = NameIn<MethodKey, N>;

type Explain<N extends MethodNamespace> = <A extends unknown[], R>(
  name: MethodName<N>,
  method: (...args: A) => Promise<R>,
  // The method alone sets the exposed signature; a callback reading fewer arguments must not drop
  // the rest from it.
  parameterFeatures?: NoInfer<ParameterFeatures<A>>,
) => (...args: A) => Promise<R>;

// Wraps one resource's gated methods as the client exposes them: the server decides whether the
// call is allowed, and a refusal it answers with reads as the feature it lacks. Parameter features
// come first, since a parameter's floor sits above its method's.
export function explainer<N extends MethodNamespace>(
  transport: Transport,
  namespace: N,
): Explain<N> {
  return (name, method, parameterFeatures) => {
    const key = methodKey(namespace, name);
    return async (...args) => {
      try {
        return await method(...args);
      } catch (error) {
        const features = [
          ...(parameterFeatures === undefined ? [] : parameterFeatures(...args)),
          ...methodRequirements(key),
        ];
        throw await transport.explainRefusal(features, error, explainOptionsOf(args));
      }
    };
  };
}

function methodKey(namespace: string, name: string): MethodKey {
  const key = `${namespace}.${name}`;
  if (!isMethodKey(key)) {
    throw new Error(`no requirements entry for ${key}`);
  }
  return key;
}

// Every resource method takes its `RequestOptions` last, and a call that leaves them out ends on
// its params instead. Metabase names no field `signal` or `timeoutMs`, so a trailing argument
// holding either is the caller's own budget for the call: its `RequestOptions`, or a wait schedule
// (`PollOptions`) whose signal and overall timeout bound the explanation as they bound the wait.
function explainOptionsOf(args: readonly unknown[]): ExplainOptions {
  const last = args.at(-1);
  if (typeof last !== "object" || last === null) {
    return {};
  }
  const signal = "signal" in last && last.signal instanceof AbortSignal ? last.signal : null;
  const timeoutMs =
    "timeoutMs" in last && typeof last.timeoutMs === "number" ? last.timeoutMs : null;
  return {
    ...(signal !== null && { signal }),
    ...(timeoutMs !== null && { timeoutMs }),
  };
}
