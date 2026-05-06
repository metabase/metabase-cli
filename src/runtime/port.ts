import { createServer } from "node:net";

import { ConfigError } from "../core/errors";

export const PORT_SCAN_LIMIT = 100;

export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

export async function findFreePort(start: number): Promise<number> {
  for (let port = start; port < start + PORT_SCAN_LIMIT; port++) {
    if (await isPortFree(port)) {
      return port;
    }
  }
  throw new ConfigError(`no free port in range ${start}..${start + PORT_SCAN_LIMIT - 1}`);
}
