import { z } from "zod";

import type { ResourceView } from "./view";

const SetupUserInput = z
  .object({
    first_name: z.string().nullable().optional(),
    last_name: z.string().nullable().optional(),
    email: z.string().min(1),
    password: z.string().min(1),
  })
  .loose();

const SetupPrefsInput = z
  .object({
    site_name: z.string().min(1),
    site_locale: z.string().min(1).nullable().optional(),
  })
  .loose();

export const SetupInput = z
  .object({
    token: z.string().min(1),
    user: SetupUserInput,
    prefs: SetupPrefsInput,
  })
  .loose();
export type SetupInput = z.infer<typeof SetupInput>;

export const SetupResult = z
  .object({
    id: z.string(),
  })
  .loose();
export type SetupResult = z.infer<typeof SetupResult>;

export const SetupResultCompact = SetupResult.pick({
  id: true,
}).strip();
export type SetupResultCompact = z.infer<typeof SetupResultCompact>;

export const setupResultView: ResourceView<SetupResult> = {
  compactPick: SetupResultCompact,
  tableColumns: [{ key: "id", label: "Session" }],
};
