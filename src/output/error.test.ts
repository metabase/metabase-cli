import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  AbortError,
  ConfigError,
  ResponseShapeError,
  UnknownError,
  ValidationError,
} from "../core/errors";
import { reportError } from "./error";

interface CapturedStreams {
  stderr: string;
}

let streams: CapturedStreams;
const originalExitCode = process.exitCode;
const originalVerbose = process.env["MB_VERBOSE"];

beforeEach(() => {
  streams = { stderr: "" };
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
      "boom\n" + JSON.stringify({ originalMessage: "boom", stack: "trace" }, null, 2) + "\n",
    );
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
    const error = new ResponseShapeError({
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
      JSON.stringify(
        { ok: false, error: { category: "config", message: "missing TTY", exitCode: 2 } },
        null,
        2,
      ) + "\n";
    expect(streams.stderr).toBe(expected);
    expect(process.exitCode).toBe(2);
  });

  it("omits detail from the JSON error envelope when MB_VERBOSE is unset", () => {
    reportError(new UnknownError({ originalMessage: "boom", stack: "trace" }), "json");
    const expected =
      JSON.stringify(
        { ok: false, error: { category: "unknown", message: "boom", exitCode: 1 } },
        null,
        2,
      ) + "\n";
    expect(streams.stderr).toBe(expected);
    expect(process.exitCode).toBe(1);
  });

  it("includes detail in the JSON error envelope when MB_VERBOSE=1", () => {
    process.env["MB_VERBOSE"] = "1";
    reportError(new UnknownError({ originalMessage: "boom", stack: "trace" }), "json");
    const expected =
      JSON.stringify(
        {
          ok: false,
          error: {
            category: "unknown",
            message: "boom",
            exitCode: 1,
            detail: { originalMessage: "boom", stack: "trace" },
          },
        },
        null,
        2,
      ) + "\n";
    expect(streams.stderr).toBe(expected);
  });
});
