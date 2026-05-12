import { createServer, type Server } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { findFreePort, isPortFree } from "./port";

describe("isPortFree", () => {
  let occupied: Server | null = null;

  afterEach(async () => {
    if (occupied !== null) {
      const server = occupied;
      occupied = null;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("returns true for an unbound port", async () => {
    const port = await pickFreePortViaOS();
    expect(await isPortFree(port)).toBe(true);
  });

  it("returns false when a server is already bound to the wildcard interface", async () => {
    const { port, server } = await bindServer();
    occupied = server;
    expect(await isPortFree(port)).toBe(false);
  });
});

describe("findFreePort", () => {
  let occupied: Server | null = null;

  afterEach(async () => {
    if (occupied !== null) {
      const server = occupied;
      occupied = null;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("returns the start port when free", async () => {
    const port = await pickFreePortViaOS();
    const result = await findFreePort(port);
    expect(result).toBe(port);
  });

  it("skips a busy port and returns the next free one", async () => {
    const { port, server } = await bindServer();
    occupied = server;
    const result = await findFreePort(port);
    expect(result).toBeGreaterThan(port);
  });
});

async function pickFreePortViaOS(): Promise<number> {
  const { port, server } = await bindServer();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function bindServer(): Promise<{ port: number; server: Server }> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", (error) => reject(error));
    server.once("listening", () => {
      const address = server.address();
      if (typeof address === "object" && address !== null) {
        resolve({ port: address.port, server });
        return;
      }
      reject(new Error("server.address() did not return an object"));
    });
    server.listen(0, "0.0.0.0");
  });
}
