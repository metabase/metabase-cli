import { STDIN_FIRST_CHUNK_TIMEOUT_MS } from "../runtime/input";

export const bodyInputFlags = {
  body: { type: "string", description: "Inline JSON body" },
  file: {
    type: "string",
    description: `Path to JSON body file, or \`-\` to read stdin. With neither flag, piped stdin is the body if it starts within ${STDIN_FIRST_CHUNK_TIMEOUT_MS} ms; for a slower pipe, pass \`--file -\``,
  },
} as const;
