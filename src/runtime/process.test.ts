import { describe, expect, it } from "vitest";

import { ProcessNotFoundError, runProcess, runProcessBinary, streamProcess } from "./process";

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

describe("runProcessBinary", () => {
  it("captures stdout as bytes preserving non-UTF8 sequences", async () => {
    const result = await runProcessBinary("node", [
      "-e",
      "process.stdout.write(Buffer.from([0,1,2,255,254,128,127]))",
    ]);
    expect(result).toEqual({
      stdout: new Uint8Array([0, 1, 2, 255, 254, 128, 127]),
      stderr: "",
      exitCode: 0,
    });
  });

  it("throws ProcessNotFoundError when the binary does not exist", async () => {
    await expect(runProcessBinary("metabase-no-such-binary-xyz", [])).rejects.toBeInstanceOf(
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

  it("honors `shell: true` so platform-shell-resolved commands run", async () => {
    const code = await streamProcess('node -e "process.exit(3)"', [], { shell: true });
    expect(code).toBe(3);
  });
});

describe("runProcess shell option", () => {
  it("interprets the command via the platform shell when shell:true", async () => {
    const result = await runProcess('node -e "process.stdout.write(String(2+2))"', [], {
      shell: true,
    });
    expect(result).toEqual({ stdout: "4", stderr: "", exitCode: 0 });
  });
});
