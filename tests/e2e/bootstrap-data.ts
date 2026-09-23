import { readFileSync, promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { isFileNotFoundError } from "@metabase/client/errors";
import { Edition, ParsedVersion } from "@metabase/client/version/tag";
import { TokenFeatures } from "@metabase/client/domain/session-properties";
import { parseJson } from "@metabase/client/json";

import { resolveStackId } from "./defaults";

const HERE = dirname(fileURLToPath(import.meta.url));

export const BOOTSTRAP_FILE_PATH = resolve(HERE, `.bootstrap.${resolveStackId()}.json`);

export const SeededIds = z.object({
  warehouseDbId: z.number().int().positive(),
  defaultCollectionId: z.number().int().positive(),
  ordersCardId: z.number().int().positive(),
  ordersDashboardId: z.number().int().positive(),
  ordersDashcardId: z.number().int().positive(),
  tables: z.object({
    orders: z.number().int().positive(),
    customers: z.number().int().positive(),
    products: z.number().int().positive(),
    reviews: z.number().int().positive(),
    orderItems: z.number().int().positive(),
    orderSummary: z.number().int().positive(),
    dailySales: z.number().int().positive(),
  }),
  fields: z.object({
    ordersId: z.number().int().positive(),
  }),
  // The admin's personal collection, the only personal collection a snapshot holds.
  adminPersonalCollectionId: z.number().int().positive(),
});
export type SeededIds = z.infer<typeof SeededIds>;

export const ServerIdentity = z.object({
  version: ParsedVersion.nullable(),
  edition: Edition.nullable().default(null),
  date: z.string().nullable().default(null),
  hash: z.string().nullable().default(null),
  tokenFeatures: TokenFeatures.nullable(),
  // Whether the server supports full-API OAuth login (full-access scope advertised in discovery).
  oauthSupported: z.boolean().default(false),
});
export type ServerIdentity = z.infer<typeof ServerIdentity>;

export const Bootstrap = z.object({
  baseUrl: z.string(),
  admin: z.object({
    email: z.string(),
    password: z.string(),
  }),
  adminApiKey: z.string(),
  adminApiKeyEmail: z.string(),
  limitedApiKey: z.string(),
  limitedApiKeyEmail: z.string(),
  seeded: SeededIds,
  server: ServerIdentity,
});

export type E2EBootstrap = z.infer<typeof Bootstrap>;

function missingBootstrapError(cause: unknown): Error {
  return new Error(
    `e2e bootstrap missing at ${BOOTSTRAP_FILE_PATH} — run \`bun run e2e:up && bun run e2e:bootstrap\` first`,
    { cause },
  );
}

export async function readBootstrap(): Promise<E2EBootstrap> {
  let raw: string;
  try {
    raw = await fs.readFile(BOOTSTRAP_FILE_PATH, "utf8");
  } catch (error) {
    if (isFileNotFoundError(error)) {
      throw missingBootstrapError(error);
    }
    throw error;
  }
  return parseJson(raw, Bootstrap, { source: BOOTSTRAP_FILE_PATH });
}

export function readBootstrapSync(): E2EBootstrap {
  let raw: string;
  try {
    raw = readFileSync(BOOTSTRAP_FILE_PATH, "utf8");
  } catch (error) {
    if (isFileNotFoundError(error)) {
      throw missingBootstrapError(error);
    }
    throw error;
  }
  return parseJson(raw, Bootstrap, { source: BOOTSTRAP_FILE_PATH });
}

export function seededIds(): SeededIds {
  return readBootstrapSync().seeded;
}
