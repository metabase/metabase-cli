import { createServer, type Server } from "node:http";

import type { NpmDistTags } from "../../packages/cli/src/core/npm-registry";

export interface RegistryFixture {
  url: string;
  setDistTags: (tags: NpmDistTags) => void;
  setStatus: (status: number, body?: string) => void;
  reset: () => void;
  close: () => Promise<void>;
}

// A stand-in npm registry: every request gets the dist-tags or the failure set last, and
// `initialTags` again after a reset.
export function startRegistryFixture(initialTags: NpmDistTags): Promise<RegistryFixture> {
  let distTags = initialTags;
  let status = 200;
  let body: string | null = null;

  const setDistTags = (tags: NpmDistTags): void => {
    distTags = tags;
    body = null;
    status = 200;
  };

  const server: Server = createServer((_req, res) => {
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(body ?? JSON.stringify(distTags));
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("server.address() did not return AddressInfo"));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        setDistTags,
        setStatus: (next, nextBody) => {
          status = next;
          body = nextBody ?? null;
        },
        reset: () => setDistTags(initialTags),
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.close((error) => {
              if (error) {
                rejectClose(error);
                return;
              }
              resolveClose();
            });
          }),
      });
    });
  });
}
