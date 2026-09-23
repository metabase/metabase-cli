import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

interface BrokerAnswer {
  status: number;
  body: unknown;
}

interface BrokerRequest {
  method: string;
  path: string;
  authorization: string | undefined;
}

export interface BrokerFixture {
  url: string;
  requests: BrokerRequest[];
  answers: BrokerAnswer[];
  close(): Promise<void>;
}

// A loopback broker the way the app runs one: each request pops the next scripted answer, and
// the requests it saw are kept for the assertion.
export async function startBrokerFixture(answers: BrokerAnswer[]): Promise<BrokerFixture> {
  const requests: BrokerRequest[] = [];
  const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
    requests.push({
      method: request.method ?? "",
      path: request.url ?? "",
      authorization: request.headers.authorization,
    });
    const answer = answers.shift();
    if (answer === undefined) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ reason: "no scripted answer left" }));
      return;
    }
    response.writeHead(answer.status, { "content-type": "application/json" });
    response.end(JSON.stringify(answer.body));
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("broker fixture did not bind a TCP port");
  }
  const { port }: AddressInfo = address;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    answers,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  };
}
