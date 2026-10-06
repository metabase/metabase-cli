import { describe, expect, it } from "vitest";

import type { RequestOptions, Transport } from "../http/transport";

import { explainer } from "./refusal";
import type { CallRequirement } from "./requirement-check";

interface ExplainCall {
  call: CallRequirement;
  error: unknown;
}

const EXPLAINED = new Error("explained");

function notOnThisPath(): never {
  throw new Error("the explainer reaches the transport only to explain a failure");
}

// A transport that records what each failure asked it to explain and answers `EXPLAINED`.
function recordingTransport(): { transport: Transport; calls: ExplainCall[] } {
  const calls: ExplainCall[] = [];
  const transport: Transport = {
    requestParsed: notOnThisPath,
    requestRaw: notOnThisPath,
    requestStream: notOnThisPath,
    server: notOnThisPath,
    verifiedServer: notOnThisPath,
    probe: notOnThisPath,
    requireFeatures: notOnThisPath,
    async explainRefusal(call, error) {
      calls.push({ call, error });
      return EXPLAINED;
    },
  };
  return { transport, calls };
}

const REFUSED = new Error("refused");

async function refuse(_kind: string, _id: number, _options: RequestOptions = {}): Promise<never> {
  throw REFUSED;
}

describe("explainer", () => {
  it("answers what the wrapped method answers and explains nothing", async () => {
    const { transport, calls } = recordingTransport();
    const { explain } = explainer(transport, "erd");

    const get = explain("get", async (id: number) => ({ id }));

    expect(await get(4)).toEqual({ id: 4 });
    expect(calls).toEqual([]);
  });

  it("explains a failure by the method's own requirements, and throws what the transport answers", async () => {
    const { transport, calls } = recordingTransport();
    const { explain } = explainer(transport, "erd");

    const get = explain("get", refuse);

    await expect(get("job", 1)).rejects.toBe(EXPLAINED);
    expect(calls).toEqual([{ call: { parameters: [], method: ["erd"] }, error: REFUSED }]);
  });

  it("puts the features the arguments bring ahead of the method's own", async () => {
    const { transport, calls } = recordingTransport();
    const { explain } = explainer(transport, "dependency");

    const graph = explain("graph", refuse, (kind) =>
      kind === "measure" ? [{ feature: "measureDependencyGraph", fields: ["type"] }] : [],
    );

    await expect(graph("measure", 1)).rejects.toBe(EXPLAINED);
    await expect(graph("card", 1)).rejects.toBe(EXPLAINED);
    expect(calls.map((recorded) => recorded.call)).toEqual([
      {
        parameters: [{ feature: "measureDependencyGraph", fields: ["type"] }],
        method: ["dependencyGraph"],
      },
      { parameters: [], method: ["dependencyGraph"] },
    ]);
  });
});
