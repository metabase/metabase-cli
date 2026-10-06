import { describe, expect, it } from "vitest";

import type { ExplainOptions, RequestOptions, Transport } from "../http/transport";
import type { PollOptions } from "../poll";

import type { FeatureName } from "./features";
import { explainer } from "./refusal";

interface ExplainCall {
  features: readonly FeatureName[];
  error: unknown;
  options: ExplainOptions | undefined;
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
    async explainRefusal(features, error, options) {
      calls.push({ features, error, options });
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
    const explain = explainer(transport, "erd");

    const get = explain("get", async (id: number) => ({ id }));

    expect(await get(4)).toEqual({ id: 4 });
    expect(calls).toEqual([]);
  });

  it("explains a failure by the method's own requirements, and throws what the transport answers", async () => {
    const { transport, calls } = recordingTransport();
    const explain = explainer(transport, "transformJob");

    const setActive = explain("setActive", refuse);

    await expect(setActive("job", 1)).rejects.toBe(EXPLAINED);
    expect(calls).toEqual([
      { features: ["transformJobActivation", "transforms"], error: REFUSED, options: {} },
    ]);
  });

  it("puts the features the arguments bring ahead of the method's own", async () => {
    const { transport, calls } = recordingTransport();
    const explain = explainer(transport, "dependency");

    const graph = explain("graph", refuse, (kind) =>
      kind === "measure" ? ["measureDependencyGraph"] : [],
    );

    await expect(graph("measure", 1)).rejects.toBe(EXPLAINED);
    await expect(graph("card", 1)).rejects.toBe(EXPLAINED);
    expect(calls.map((call) => call.features)).toEqual([
      ["measureDependencyGraph", "dependencyGraph"],
      ["dependencyGraph"],
    ]);
  });

  it("hands the explanation the caller's signal and timeout from the trailing options", async () => {
    const { transport, calls } = recordingTransport();
    const explain = explainer(transport, "erd");
    const controller = new AbortController();

    const get = explain("get", refuse);

    await expect(
      get("x", 1, { signal: controller.signal, timeoutMs: 250, retries: 0 }),
    ).rejects.toBe(EXPLAINED);
    expect(calls.map((call) => call.options)).toEqual([
      { signal: controller.signal, timeoutMs: 250 },
    ]);
  });

  it("bounds the explanation by a trailing wait schedule's signal and overall timeout", async () => {
    const { transport, calls } = recordingTransport();
    const explain = explainer(transport, "gitSync");
    const controller = new AbortController();

    const waitForTask = explain("waitForTask", async (_wait: PollOptions) => {
      throw REFUSED;
    });

    await expect(
      waitForTask({ intervalMs: 10, timeoutMs: 600_000, signal: controller.signal }),
    ).rejects.toBe(EXPLAINED);
    expect(calls.map((call) => call.options)).toEqual([
      { signal: controller.signal, timeoutMs: 600_000 },
    ]);
  });

  it("reads no options from a trailing params object", async () => {
    const { transport, calls } = recordingTransport();
    const explain = explainer(transport, "erd");

    const get = explain("get", async (_params: { "database-id": number }) => {
      throw REFUSED;
    });

    await expect(get({ "database-id": 1 })).rejects.toBe(EXPLAINED);
    expect(calls.map((call) => call.options)).toEqual([{}]);
  });
});
