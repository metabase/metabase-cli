import { describe, expect, it } from "vitest";

import { ProcessNotFoundError, runProcess, streamProcess } from "./process";

describe("runProcess", () => {
  it("captures stdout and exit code 0", async () => {
    const result = await runProcess("node", ["-e", "process.stdout.write('hello')"]);
    expect(result).toEqual({ stdout: "hello", stderr: "", exitCode: 0 });
  });

  it("captures stderr and a non-zero exit code", async () => {
    const result = await runProcess("node", [
      "-e",
      "process.stderr.write('boom'); process.exit(2)",
    ]);
    expect(result).toEqual({ stdout: "", stderr: "boom", exitCode: 2 });
  });

  it("forwards stdin to the child", async () => {
    const result = await runProcess(
      "node",
      ["-e", "let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(d))"],
      { stdin: "piped-input" },
    );
    expect(result).toEqual({ stdout: "piped-input", stderr: "", exitCode: 0 });
  });

  it("throws ProcessNotFoundError when the binary does not exist", async () => {
    await expect(runProcess("metabase-no-such-binary-xyz", [])).rejects.toBeInstanceOf(
      ProcessNotFoundError,
    );
  });
});

describe("streamProcess", () => {
  it("returns the child's exit code", async () => {
    const code = await streamProcess("node", ["-e", "process.exit(7)"]);
    expect(code).toBe(7);
  });

  it("throws ProcessNotFoundError when the binary does not exist", async () => {
    await expect(streamProcess("metabase-no-such-binary-xyz", [])).rejects.toBeInstanceOf(
      ProcessNotFoundError,
    );
  });
});
