import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  browserOpener,
  browserUnavailableReason,
  ProcessNotFoundError,
  runProcess,
  runProcessBinary,
  streamProcess,
} from "./process";

const AUTHORIZE_URL =
  "https://mb.example.com/oauth/authorize?response_type=code&client_id=abc&state=xyz&scope=mb:full";

describe("browserOpener", () => {
  it("passes the URL as a single argv element on darwin and linux", () => {
    expect(browserOpener("darwin", AUTHORIZE_URL)).toEqual({
      command: "open",
      args: [AUTHORIZE_URL],
      windowsVerbatim: false,
    });
    expect(browserOpener("linux", AUTHORIZE_URL)).toEqual({
      command: "xdg-open",
      args: [AUTHORIZE_URL],
      windowsVerbatim: false,
    });
  });

  it("escapes cmd metacharacters so a `&`-laden URL survives `cmd /c start` intact", () => {
    expect(browserOpener("win32", AUTHORIZE_URL)).toEqual({
      command: "cmd",
      args: [
        "/c",
        "start",
        '""',
        "https://mb.example.com/oauth/authorize?response_type=code^&client_id=abc^&state=xyz^&scope=mb:full",
      ],
      windowsVerbatim: true,
    });
  });

  it("escapes injected command separators in a hostile authorization endpoint", () => {
    const hostile = "https://mb.example.com/authorize?x=1&calc.exe|whoami>out";
    expect(browserOpener("win32", hostile).args[3]).toBe(
      "https://mb.example.com/authorize?x=1^&calc.exe^|whoami^>out",
    );
  });

  it("property: every cmd metacharacter is ^-escaped and the URL round-trips", () => {
    const urlChar = fc.constantFrom(...'&|<>^()"%!', ..."abz09:/?=._-~");
    const url = fc.array(urlChar, { minLength: 1, maxLength: 64 }).map((chars) => chars.join(""));
    fc.assert(
      fc.property(url, (input) => {
        const escaped = browserOpener("win32", input).args[3] ?? "";
        expect(decodeCmdEscapes(escaped)).toBe(input);
      }),
    );
  });
});

const CMD_METACHARACTERS = new Set('&|<>^()"%!');

// Walks the escaped string the way cmd.exe would: a ^ must be followed by the metacharacter it
// escapes, and no metacharacter may appear outside such a pair. Returns the decoded original.
function decodeCmdEscapes(escaped: string): string {
  let decoded = "";
  let i = 0;
  while (i < escaped.length) {
    const char = escaped[i] ?? "";
    if (char === "^") {
      const next = escaped[i + 1] ?? "";
      expect(CMD_METACHARACTERS.has(next)).toBe(true);
      decoded += next;
      i += 2;
      continue;
    }
    expect(CMD_METACHARACTERS.has(char)).toBe(false);
    decoded += char;
    i += 1;
  }
  return decoded;
}

describe("browserUnavailableReason", () => {
  const SSH = { SSH_CONNECTION: "10.0.0.1 50000 10.0.0.2 22" };

  it("lets a desktop session open a browser", () => {
    expect(browserUnavailableReason("darwin", {})).toBeNull();
    expect(browserUnavailableReason("win32", {})).toBeNull();
    expect(browserUnavailableReason("linux", { DISPLAY: ":0" })).toBeNull();
    expect(browserUnavailableReason("linux", { WAYLAND_DISPLAY: "wayland-0" })).toBeNull();
  });

  it("refuses over SSH, where the browser would open on the remote host", () => {
    expect(browserUnavailableReason("linux", { ...SSH, DISPLAY: "localhost:10.0" })).toBe(
      "this is an SSH session",
    );
    expect(browserUnavailableReason("darwin", { SSH_TTY: "/dev/ttys001" })).toBe(
      "this is an SSH session",
    );
  });

  it("refuses on a Unix host with no display server", () => {
    expect(browserUnavailableReason("linux", {})).toBe("no graphical display is available");
    expect(browserUnavailableReason("freebsd", { DISPLAY: "" })).toBe(
      "no graphical display is available",
    );
  });

  it("trusts an explicit $BROWSER even over SSH", () => {
    expect(
      browserUnavailableReason("linux", { ...SSH, BROWSER: "/usr/bin/forward-open" }),
    ).toBeNull();
  });
});

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
