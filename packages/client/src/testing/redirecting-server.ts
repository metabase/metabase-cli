import { createServer, type Server } from "node:http";

const TEMPORARY_REDIRECT_STATUS = 307;
const LOOPBACK = "127.0.0.1";

export interface RedirectingServer {
  // Answers every request with a redirect to `target`, keeping its path.
  url: string;
  // Answers every request with 200 and counts it.
  target: string;
  targetRequests: () => number;
  close: () => Promise<void>;
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, LOOPBACK, resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("a loopback test server has no port");
  }
  return `http://${LOOPBACK}:${String(address.port)}`;
}

async function stop(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

export async function redirectingServer(): Promise<RedirectingServer> {
  let requests = 0;
  const targetServer = createServer((_request, response) => {
    requests += 1;
    response.writeHead(200, { "content-type": "application/json" }).end("{}");
  });
  const target = await listen(targetServer);
  const redirecting = createServer((request, response) => {
    response
      .writeHead(TEMPORARY_REDIRECT_STATUS, { location: `${target}${request.url ?? "/"}` })
      .end();
  });
  const url = await listen(redirecting);
  return {
    url,
    target,
    targetRequests: () => requests,
    close: async () => {
      await stop(redirecting);
      await stop(targetServer);
    },
  };
}
