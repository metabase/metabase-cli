import type { Client, RequestOptions } from "@metabase/cli/client";
import { type InstanceContext, UNKNOWN_INSTANCE } from "../metabase/probe";
import type { MetabaseToolDeps } from "./deps";

const JSON_HEADERS = { "content-type": "application/json" } as const;

export interface RecordedRequest {
  path: string;
  method: string;
  options: RequestOptions | undefined;
}

export type Responder = (path: string, options: RequestOptions | undefined) => unknown;

export interface FakeClientResult {
  client: Client;
  requests: RecordedRequest[];
}

export interface ToolDepsResult {
  deps: MetabaseToolDeps;
  requests: RecordedRequest[];
}

export function toolDeps(
  handler: Responder,
  cwd = "/tmp",
  instance: InstanceContext = UNKNOWN_INSTANCE,
): ToolDepsResult {
  const { client, requests } = fakeClient(handler);
  return { deps: { client, cwd, instance }, requests };
}

export function fakeClient(handler: Responder): FakeClientResult {
  const requests: RecordedRequest[] = [];
  const record = (path: string, options: RequestOptions | undefined): void => {
    requests.push({ path, method: options?.method ?? "GET", options });
  };
  const client: Client = {
    requestParsed: (schema, path, options) => {
      record(path, options);
      return Promise.resolve(schema.parse(handler(path, options)));
    },
    requestRaw: (path, options) => {
      record(path, options);
      const raw = handler(path, options);
      if (raw instanceof Response) {
        return Promise.resolve(raw);
      }
      return Promise.resolve(
        new Response(JSON.stringify(raw ?? null), { status: 200, headers: JSON_HEADERS }),
      );
    },
    requestStream: (path, options) => {
      record(path, options);
      const raw = handler(path, options);
      const text = typeof raw === "string" ? raw : JSON.stringify(raw);
      return Promise.resolve(streamOf(text));
    },
  };
  return { client, requests };
}

function streamOf(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}
