import { InternalError } from "../errors";
import type { Transport } from "../http/transport";

import type { CallRequirement, ParameterRequirement } from "./requirement-check";
import { isMethodKey, type MethodKey, methodRequirements } from "./requirements";

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
