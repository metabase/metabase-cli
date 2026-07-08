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
type CliErrorEnvelope = z.infer<typeof CliErrorEnvelope>;

// The e2e harness is never a TTY, so the CLI renders errors as a JSON envelope on stderr (the
// agent-facing path); in a TTY it renders plain text. Any leading warn() lines (e.g. preflight
// notices) precede the envelope, whose first line starts with "{".
function parseEnvelope(stderr: string): CliErrorEnvelope | null {
  const lines = stderr.split("\n");
  const start = lines.findIndex((line) => line.startsWith("{"));
  if (start === -1) {
    return null;
  }
  return parseJson(lines.slice(start).join("\n"), CliErrorEnvelope);
}

// Return the human message whether stderr is a JSON envelope or plain TTY text, so a test can
// match the message regardless of the rendered format.
export function cliErrorMessage(stderr: string): string {
  return parseEnvelope(stderr)?.error.message ?? stderr;
}

export function cliErrorCategory(stderr: string): string | null {
  return parseEnvelope(stderr)?.error.category ?? null;
}
