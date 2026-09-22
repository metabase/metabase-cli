import { z } from "zod";

import {
  PythonLibrary,
  type PythonLibraryUpdateInput,
  PythonTestRunError,
  type PythonTestRunInput,
  PythonTestRunOutput,
  type PythonTestRunResult,
} from "../domain/transform-python";
import type { RequestOptions, Transport } from "../http/transport";

// The two answers a test run gives share only `logs`, so each is told apart by the key only it
// carries.
const PythonApiTestRun: z.ZodType<PythonTestRunResult> = z.union([
  z
    .object({ logs: z.string(), output: PythonTestRunOutput })
    .transform(({ logs, output }) => ({ outcome: "succeeded" as const, logs, output })),
  z
    .object({ logs: z.string(), error: PythonTestRunError })
    .transform(({ logs, error }) => ({ outcome: "failed" as const, logs, error })),
]);

function libraryPath(path: string): string {
  return `/api/ee/transforms-python/library/${encodeURIComponent(path)}`;
}

export function transformPythonResource(transport: Transport) {
  /** Get the Python library at a path, the user module every Python transform can import. */
  async function getLibrary(path: string, options: RequestOptions = {}): Promise<PythonLibrary> {
    await transport.require("transformPython.getLibrary", options);
    return transport.requestParsed(PythonLibrary, libraryPath(path), { ...options });
  }

  /** Replace the source of the Python library at a path, creating the library when none exists. */
  async function updateLibrary(
    path: string,
    params: PythonLibraryUpdateInput,
    options: RequestOptions = {},
  ): Promise<PythonLibrary> {
    await transport.require("transformPython.updateLibrary", options);
    return transport.requestParsed(PythonLibrary, libraryPath(path), {
      ...options,
      method: "PUT",
      body: params,
    });
  }

  /**
   * Evaluate an ad-hoc Python transform on a sample of its source tables, without a target table.
   * Meant for early feedback on short runs: input, output and time limits apply, and the sample
   * sizes are capped at 100 rows.
   */
  async function testRun(
    params: PythonTestRunInput,
    options: RequestOptions = {},
  ): Promise<PythonTestRunResult> {
    await transport.require("transformPython.testRun", options);
    return transport.requestParsed(PythonApiTestRun, "/api/ee/transforms-python/test-run", {
      ...options,
      method: "POST",
      body: params,
    });
  }

  return { getLibrary, updateLibrary, testRun };
}
