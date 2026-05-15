import { z } from "zod";

import { listProfileNames, readProfile } from "../../core/auth/storage";
import { originOnly } from "../../core/url";
import type { ResourceView } from "../../domain/view";
import { renderList } from "../../output/render";
import { listEnvelopeSchema, wrapList } from "../../output/types";
import { outputFlags } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export const AuthProfile = z.object({
  profile: z.string(),
  url: z.string().nullable(),
  present: z.boolean(),
});
export type AuthProfileJson = z.infer<typeof AuthProfile>;

export const AuthProfileListEnvelope = listEnvelopeSchema(AuthProfile);

const authProfileView: ResourceView<AuthProfileJson> = {
  compactPick: AuthProfile,
  tableColumns: [
    { key: "profile", label: "Profile" },
    { key: "url", label: "URL" },
    { key: "present", label: "Authenticated" },
  ],
};

export default defineMetabaseCommand({
  meta: { name: "list", description: "List configured authentication profiles" },
  args: { ...outputFlags },
  outputSchema: AuthProfileListEnvelope,
  examples: ["mb auth list", "mb auth list --json"],
  async run({ ctx }) {
    const names = await listProfileNames();
    const items = await Promise.all(
      names.map(async (name): Promise<AuthProfileJson> => {
        const profile = await readProfile(name);
        return {
          profile: name,
          url: profile === null ? null : originOnly(profile.url),
          present: profile !== null,
        };
      }),
    );
    renderList(wrapList(items), authProfileView, ctx);
  },
});
