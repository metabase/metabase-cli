import { z } from "zod";

import { parseJson } from "../../src/runtime/json";

const CliErrorEnvelope = z
  .object({
    ok: z.literal(false),
    error: z
      .object({
        category: z.string(),
        message: z.string(),
        exitCode: z.number(),
      })
      .loose(),
  })
  .loose();

// The e2e harness is never a TTY, so the CLI renders errors as a JSON envelope on stderr (the
// agent-facing path); in a TTY it renders plain text. Return the human message either way so a
// test can match the message regardless of the rendered format. Any leading warn() lines (e.g.
// preflight notices) precede the envelope, which always opens with a bare "{" line.
export function cliErrorMessage(stderr: string): string {
  const lines = stderr.split("\n");
  const start = lines.indexOf("{");
  if (start === -1) {
    return stderr;
  }
  return parseJson(lines.slice(start).join("\n"), CliErrorEnvelope).error.message;
}
