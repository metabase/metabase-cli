import { PassThrough } from "node:stream";

import { TextPrompt } from "@clack/core";
import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  AbortError,
  ConfigError,
  type ErrorCategory,
  ResponseShapeError,
  UnknownError,
  ValidationError,
} from "@metabase/client/errors";
import { HttpError } from "@metabase/client/http/errors";
import { checkCapabilities } from "@metabase/client/version/capabilities";
import { CapabilityError } from "@metabase/client/version/preflight-error";
import { exitCodeFor, reportError } from "./error";

interface CapturedStreams {
  stderr: string;
}

let streams: CapturedStreams;
const originalExitCode = process.exitCode;
const originalVerbose = process.env["MB_VERBOSE"];

beforeEach(() => {
  streams = { stderr: "" };
  process.stderr.isTTY = false;
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    streams.stderr += String(chunk);
    return true;
  });
  process.exitCode = 0;
  delete process.env["MB_VERBOSE"];
  delete process.env["METABASE_VERBOSE"];
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = originalExitCode;
  if (originalVerbose === undefined) {
    delete process.env["MB_VERBOSE"];
  } else {
    process.env["MB_VERBOSE"] = originalVerbose;
  }
});

const CTRL_C_BYTE = 0x03;

// clack's cancel value is a module-private `Symbol("clack:cancel")`, so the only way to obtain a
// genuine one is to drive a real prompt to cancellation.
async function realClackCancelValue(): Promise<symbol> {
  const input = new PassThrough();
  const prompt = new TextPrompt({ input, output: new PassThrough(), render: () => "" });
  const pending = prompt.prompt();
  input.write(Buffer.from([CTRL_C_BYTE]));
  const value = await pending;
  assert(typeof value === "symbol", "expected clack to resolve with its cancel symbol");
  return value;
}

const CATEGORIES: ReadonlyArray<ErrorCategory> = [
  "network",
  "http",
  "validation",
  "response-shape",
  "timeout",
  "config",
  "capability",
  "abort",
  "internal",
  "unknown",
];

// Typed as a total record so a category added to the taxonomy fails to compile here as well as
// in the switch it pins.
const EXPECTED_EXIT_CODES: Record<ErrorCategory, number> = {
  network: 1,
  http: 1,
  validation: 1,
  "response-shape": 1,
  timeout: 1,
  config: 2,
  capability: 2,
  abort: 130,
  internal: 1,
  unknown: 1,
};

describe("exitCodeFor", () => {
  it("maps every category in the error taxonomy to its exit code", () => {
    const actual = Object.fromEntries(
      CATEGORIES.map((category) => [category, exitCodeFor(category)]),
    );
    expect(actual).toEqual(EXPECTED_EXIT_CODES);
  });
});

describe("reportError", () => {
  it("writes the user message to stderr and sets exit code 2 for ConfigError", () => {
    reportError(new ConfigError("missing TTY"));
    expect(streams.stderr).toBe("missing TTY\n");
    expect(process.exitCode).toBe(2);
  });

  it("sets exit code 130 for AbortError", () => {
    reportError(new AbortError());
    expect(streams.stderr).toBe("aborted\n");
    expect(process.exitCode).toBe(130);
  });

  it("maps a raw clack cancel value to the abort category and exit code 130", async () => {
    reportError(await realClackCancelValue(), "json");
    const expected =
      JSON.stringify({
        ok: false,
        error: { category: "abort", message: "aborted", exitCode: 130 },
      }) + "\n";
    expect(streams.stderr).toBe(expected);
    expect(process.exitCode).toBe(130);
  });

  it("sets exit code 1 for UnknownError wrapping a generic Error", () => {
    reportError(new Error("kaboom"));
    expect(streams.stderr).toBe("kaboom\n(rerun with MB_VERBOSE=1 for details)\n");
    expect(process.exitCode).toBe(1);
  });

  it("appends the verbose breadcrumb (not the detail) when MB_VERBOSE is unset and detail exists", () => {
    reportError(new UnknownError({ originalMessage: "boom", stack: "trace" }));
    expect(streams.stderr).toBe("boom\n(rerun with MB_VERBOSE=1 for details)\n");
  });

  it("appends developerDetail JSON when MB_VERBOSE=1 and the error carries detail", () => {
    process.env["MB_VERBOSE"] = "1";
    reportError(new UnknownError({ originalMessage: "boom", stack: "trace" }));
    expect(streams.stderr).toBe(
      "boom\n" + JSON.stringify({ originalMessage: "boom", stack: "trace" }) + "\n",
    );
  });

  it("offers the client downgrade when the server is below the required version", () => {
    const failure = checkCapabilities(
      { version: { tag: "v0.58.0", major: 58, patch: 0 }, tokenFeatures: null },
      { minVersion: 61 },
    );
    assert(failure !== null);
    reportError(new CapabilityError(failure));
    expect(streams.stderr).toBe(
      "This operation requires Metabase v61+ (this server is v0.58.0). Upgrade Metabase to use it.\n" +
        "Or install an `@metabase/cli` release that targets this server.\n" +
        "(rerun with MB_VERBOSE=1 for details)\n",
    );
    expect(process.exitCode).toBe(2);
  });

  it("withholds the client downgrade when a premium feature is missing, which no client version supplies", () => {
    const failure = checkCapabilities(
      { version: { tag: "v0.61.0", major: 61, patch: 0 }, tokenFeatures: null },
      { minVersion: 61, tokenFeature: "library" },
    );
    assert(failure !== null);
    reportError(new CapabilityError(failure));
    expect(streams.stderr).toBe(
      "This operation requires the 'library' premium feature (not enabled on this server).\n" +
        "(rerun with MB_VERBOSE=1 for details)\n",
    );
  });

  it("carries the client downgrade into the JSON envelope, where there is no second line to print it on", () => {
    const failure = checkCapabilities(
      { version: { tag: "v0.58.0", major: 58, patch: 0 }, tokenFeatures: null },
      { minVersion: 61 },
    );
    assert(failure !== null);
    reportError(new CapabilityError(failure), "json");
    expect(streams.stderr).toBe(
      JSON.stringify({
        ok: false,
        error: {
          category: "capability",
          message:
            "This operation requires Metabase v61+ (this server is v0.58.0). Upgrade Metabase to use it.\n" +
            "Or install an `@metabase/cli` release that targets this server.",
          exitCode: 2,
        },
      }) + "\n",
    );
  });

  function routeMissingError(): HttpError {
    return new HttpError({
      status: 404,
      statusText: "Not Found",
      method: "GET",
      url: "https://m.example.com/api/transform",
      responseHeaders: { "content-type": "text/plain" },
      rawBody: "API endpoint does not exist.",
      serverTag: "v0.58.7",
    });
  }

  it("names the command that shows the server version when an endpoint is missing from it", () => {
    reportError(routeMissingError());
    expect(streams.stderr).toBe(
      "This endpoint is not available on Metabase v0.58.7: GET /api/transform. " +
        "It may require a newer Metabase major version.\n" +
        "Run `mb auth list` to see this server's version.\n" +
        "(rerun with MB_VERBOSE=1 for details)\n",
    );
    expect(process.exitCode).toBe(1);
  });

  it("carries the route-missing remedy into the JSON envelope", () => {
    reportError(routeMissingError(), "json");
    expect(streams.stderr).toBe(
      JSON.stringify({
        ok: false,
        error: {
          category: "http",
          message:
            "This endpoint is not available on Metabase v0.58.7: GET /api/transform. " +
            "It may require a newer Metabase major version.\n" +
            "Run `mb auth list` to see this server's version.",
          exitCode: 1,
        },
      }) + "\n",
    );
  });

  it("leaves an ordinary HTTP failure without a remedy line", () => {
    reportError(
      new HttpError({
        status: 500,
        statusText: "Internal Server Error",
        method: "GET",
        url: "https://m.example.com/api/transform",
        responseHeaders: { "content-type": "text/plain" },
        rawBody: null,
      }),
    );
    expect(streams.stderr).toBe("Metabase returned 500.\n(rerun with MB_VERBOSE=1 for details)\n");
  });

  it("carries the rejected fields into the JSON error envelope under MB_VERBOSE=1", () => {
    process.env["MB_VERBOSE"] = "1";
    const rawBody = JSON.stringify({ errors: { name: "value must be a non-blank string." } });
    reportError(
      new HttpError({
        status: 400,
        statusText: "Bad Request",
        method: "POST",
        url: "https://m.example.com/api/card",
        responseHeaders: { "content-type": "application/json" },
        rawBody,
      }),
      "json",
    );
    const expected =
      JSON.stringify({
        ok: false,
        error: {
          category: "http",
          message: "name: value must be a non-blank string.",
          exitCode: 1,
          detail: {
            status: 400,
            statusText: "Bad Request",
            method: "POST",
            url: "https://m.example.com/api/card",
            responseHeaders: { "content-type": "application/json" },
            body: rawBody,
            fieldErrors: { name: "value must be a non-blank string." },
            specificFieldErrors: null,
          },
        },
      }) + "\n";
    expect(streams.stderr).toBe(expected);
  });

  it("does not append developerDetail JSON when MB_VERBOSE=1 but detail is null", () => {
    process.env["MB_VERBOSE"] = "1";
    reportError(new ConfigError("nope"));
    expect(streams.stderr).toBe("nope\n");
    expect(process.exitCode).toBe(2);
  });

  it("normalizes a non-MetabaseError value (string) into an UnknownError envelope", () => {
    reportError("plain string");
    expect(streams.stderr).toBe("plain string\n(rerun with MB_VERBOSE=1 for details)\n");
    expect(process.exitCode).toBe(1);
  });

  it("prints the JSON-pointer issue path on the stderr line beneath the ValidationError header", () => {
    const schema = z.object({ total: z.number() });
    const result = schema.safeParse({ total: null });
    assert(!result.success, "expected zod failure");
    reportError(
      new ValidationError(
        "https://m.example.com/api/collection/8/items: value did not match expected schema",
        {
          source: "https://m.example.com/api/collection/8/items",
          zodIssues: result.error.issues,
        },
      ),
    );
    expect(streams.stderr).toBe(
      "https://m.example.com/api/collection/8/items: value did not match expected schema\n" +
        "  /total: Invalid input: expected number, received null\n" +
        "(rerun with MB_VERBOSE=1 for details)\n",
    );
    expect(process.exitCode).toBe(1);
  });

  it("prints the ResponseShapeError lead and field paths and exits 1", () => {
    const schema = z.object({ version: z.object({ tag: z.string() }) });
    const result = schema.safeParse({ version: {} });
    assert(!result.success, "expected zod failure");
    const error = ResponseShapeError.fromZodIssues({
      kind: "zod",
      method: "GET",
      url: "https://m.example.com/api/session/properties",
      status: 200,
      zodIssues: result.error.issues,
      serverTag: null,
    });

    reportError(error);

    expect(streams.stderr).toBe(
      "Metabase returned unexpected response shape:\n" +
        "  version.tag: Invalid input: expected string, received undefined\n" +
        "(rerun with MB_VERBOSE=1 for details)\n",
    );
    expect(process.exitCode).toBe(1);
  });

  it("emits a JSON error envelope to stderr (no detail) when format is json", () => {
    reportError(new ConfigError("missing TTY"), "json");
    const expected =
      JSON.stringify({
        ok: false,
        error: { category: "config", message: "missing TTY", exitCode: 2 },
      }) + "\n";
    expect(streams.stderr).toBe(expected);
    expect(process.exitCode).toBe(2);
  });

  it("omits detail from the JSON error envelope when MB_VERBOSE is unset", () => {
    reportError(new UnknownError({ originalMessage: "boom", stack: "trace" }), "json");
    const expected =
      JSON.stringify({
        ok: false,
        error: { category: "unknown", message: "boom", exitCode: 1 },
      }) + "\n";
    expect(streams.stderr).toBe(expected);
    expect(process.exitCode).toBe(1);
  });

  it("includes detail in the JSON error envelope when MB_VERBOSE=1", () => {
    process.env["MB_VERBOSE"] = "1";
    reportError(new UnknownError({ originalMessage: "boom", stack: "trace" }), "json");
    const expected =
      JSON.stringify({
        ok: false,
        error: {
          category: "unknown",
          message: "boom",
          exitCode: 1,
          detail: { originalMessage: "boom", stack: "trace" },
        },
      }) + "\n";
    expect(streams.stderr).toBe(expected);
  });
});
