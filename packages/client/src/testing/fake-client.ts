import type { ZodType } from "zod";

import {
  type Transport,
  DEFAULT_METHOD,
  type HttpMethod,
  type TransportRequestOptions,
} from "../http/transport";
import { NO_SERVER_TAG, parseJsonResponse } from "../http/response-shape";

const FAKE_STATUS = 200;

export interface FakeClientCall {
  readonly method: HttpMethod;
  readonly path: string;
  readonly options: TransportRequestOptions | undefined;
}

export type FakeResponder = (call: FakeClientCall) => unknown;

export interface FakeBodyReply {
  readonly kind: "body";
  readonly body: unknown;
}

export interface FakeErrorReply {
  readonly kind: "error";
  readonly error: Error;
}

export interface FakeRespondReply {
  readonly kind: "respond";
  readonly respond: FakeResponder;
}

export type FakeReply = FakeBodyReply | FakeErrorReply | FakeRespondReply;

export interface FakeRoute {
  readonly method?: HttpMethod;
  readonly path: string;
  readonly reply: FakeReply;
}

export interface FakeClientPlan {
  readonly routes?: ReadonlyArray<FakeRoute>;
}

export interface FakeClient {
  readonly client: Transport;
  readonly calls: ReadonlyArray<FakeClientCall>;
}

export function createFakeClient(plan: FakeClientPlan = {}): FakeClient {
  const calls: FakeClientCall[] = [];
  const client: Transport = {
    async requestParsed<T>(
      schema: ZodType<T>,
      path: string,
      options?: TransportRequestOptions,
    ): Promise<T> {
      const call: FakeClientCall = { method: options?.method ?? DEFAULT_METHOD, path, options };
      calls.push(call);
      const route = plan.routes?.find(
        (candidate) =>
          candidate.path === call.path && (candidate.method ?? DEFAULT_METHOD) === call.method,
      );
      if (route === undefined) {
        throw new Error(`unexpected request: ${call.method} ${call.path}`);
      }
      if (route.reply.kind === "error") {
        throw route.reply.error;
      }
      const body = route.reply.kind === "body" ? route.reply.body : route.reply.respond(call);
      // Serializing mirrors the real boundary, where a body only ever reaches a schema as bytes.
      return parseJsonResponse(JSON.stringify(body), schema, {
        method: call.method,
        url: call.path,
        status: FAKE_STATUS,
        getServerTag: NO_SERVER_TAG,
      });
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
