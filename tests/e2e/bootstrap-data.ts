import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { isNotFoundError } from "../../src/core/errors";
import { parseJson } from "../../src/runtime/json";

const HERE = dirname(fileURLToPath(import.meta.url));

export const BOOTSTRAP_FILE_PATH = resolve(HERE, ".bootstrap.json");

export const Bootstrap = z.object({
  baseUrl: z.string(),
  admin: z.object({
    email: z.string(),
    password: z.string(),
  }),
  adminApiKey: z.string(),
  adminApiKeyEmail: z.string(),
});

export type E2EBootstrap = z.infer<typeof Bootstrap>;

export async function readBootstrap(): Promise<E2EBootstrap> {
  let raw: string;
  try {
    raw = await fs.readFile(BOOTSTRAP_FILE_PATH, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      throw new Error(
        `e2e bootstrap missing at ${BOOTSTRAP_FILE_PATH} — run \`bun run e2e:up && bun run e2e:bootstrap\` first`,
        { cause: error },
      );
    }
    throw error;
  }
  return parseJson(raw, Bootstrap, { source: BOOTSTRAP_FILE_PATH });
}
