import type { Client, RequestOptions } from "@metabase/cli/client";
import { ConfigError } from "@metabase/cli/errors";
import type { ZodType } from "zod";
import type { MetabaseConnection } from "./connection";
import { type InstanceContext, UNKNOWN_INSTANCE } from "./probe";

const NOT_AUTHENTICATED =
  "Not authenticated to Metabase. Run `/mb-login <url>` to sign in through the browser; the session then reaches the instance without restarting.";

// The instance the session talks to, which `/mb-login` may only establish once the TUI is already
// open. The curated tools close over `client` when the session is built, so it cannot be the client
// itself — it is this switch, which routes every request to whichever connection is current and
// refuses, with an answer the model can act on, while there is none.
export class MetabaseAccess {
  private connection: MetabaseConnection | null = null;
  private probed: InstanceContext = UNKNOWN_INSTANCE;
  readonly client: Client;

  constructor(connection: MetabaseConnection | null, instance: InstanceContext = UNKNOWN_INSTANCE) {
    this.connection = connection;
    this.probed = instance;
    this.client = {
      requestParsed: async <T>(
        schema: ZodType<T>,
        path: string,
        opts?: RequestOptions,
      ): Promise<T> => this.current().requestParsed(schema, path, opts),
      requestRaw: async (path: string, opts?: RequestOptions): Promise<Response> =>
        this.current().requestRaw(path, opts),
      requestStream: async (
        path: string,
        opts?: RequestOptions,
      ): Promise<ReadableStream<Uint8Array>> => this.current().requestStream(path, opts),
    };
  }

  authenticated(): boolean {
    return this.connection !== null;
  }

  url(): string | null {
    return this.connection?.url ?? null;
  }

  instance(): InstanceContext {
    return this.probed;
  }

  adopt(connection: MetabaseConnection, instance: InstanceContext): void {
    this.connection = connection;
    this.probed = instance;
  }

  private current(): Client {
    if (this.connection === null) {
      throw new ConfigError(NOT_AUTHENTICATED);
    }
    return this.connection.client;
  }
}
