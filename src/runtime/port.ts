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
    // 0.0.0.0 (not 127.0.0.1) — docker publishes container ports on the
    // wildcard address, and a 127.0.0.1-only probe can return "free" while
    // docker holds the port at 0.0.0.0.
    server.listen(port, "0.0.0.0");
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
