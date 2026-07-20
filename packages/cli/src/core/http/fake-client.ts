import type { ZodType } from "zod";

import type { Client, RequestOptions } from "./client";

export interface FakeClientPlan {
  readonly responses?: ReadonlyMap<string, unknown>;
  readonly errors?: ReadonlyMap<string, Error>;
}

export interface FakeClientCall {
  readonly path: string;
  readonly options: RequestOptions | undefined;
}

export interface FakeClient {
  readonly client: Client;
  readonly calls: ReadonlyArray<FakeClientCall>;
}

export function createFakeClient(plan: FakeClientPlan = {}): FakeClient {
  const calls: FakeClientCall[] = [];
  const client: Client = {
    async requestParsed<T>(schema: ZodType<T>, path: string, options?: RequestOptions): Promise<T> {
      calls.push({ path, options });
      const failure = plan.errors?.get(path);
      if (failure !== undefined) {
        throw failure;
      }
      const response = plan.responses?.get(path);
      if (response === undefined) {
        throw new Error(`unexpected path: ${path}`);
      }
      return schema.parse(response);
    },
    async requestRaw() {
      throw new Error("requestRaw not implemented in fake client");
    },
    async requestStream() {
      throw new Error("requestStream not implemented in fake client");
    },
  };
  return { client, calls };
}
