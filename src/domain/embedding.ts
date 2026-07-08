import { z } from "zod";

export const EmbeddingParams = z.record(z.string(), z.enum(["disabled", "enabled", "locked"]));
export type EmbeddingParams = z.infer<typeof EmbeddingParams>;
