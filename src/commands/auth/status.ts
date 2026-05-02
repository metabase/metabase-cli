import { z } from "zod";

import { account, credentials } from "../../core/auth/storage";
import { resolveProfileName } from "../../core/config";
import { originOnly } from "../../core/url";
import type { ResourceView } from "../../domain/view";
import { renderItem } from "../../output/render";
import { outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export const AuthStatus = z.object({
  profile: z.string(),
  present: z.boolean(),
  url: z.string().nullable(),
});
export type AuthStatusJson = z.infer<typeof AuthStatus>;

const authStatusView: ResourceView<AuthStatusJson> = {
  compactPick: AuthStatus,
  tableColumns: [
    { key: "profile", label: "Profile" },
    { key: "present", label: "Authenticated" },
    { key: "url", label: "URL" },
  ],
};

export default defineMetabaseCommand({
  meta: { name: "status", description: "Show authentication status for a profile" },
  args: { ...outputFlags, ...profileFlag },
  outputSchema: AuthStatus,
  examples: ["metabase auth status --json", "metabase auth status --profile staging"],
  async run({ args, ctx }) {
    const profileName = resolveProfileName(args.profile);

    const [url, apiKey] = await Promise.all([
      credentials.read(account.profileUrl(profileName)),
      credentials.read(account.profileApiKey(profileName)),
    ]);
    const present = url !== null && apiKey !== null;

    const payload: AuthStatusJson = {
      profile: profileName,
      present,
      url: url === null ? null : originOnly(url),
    };

    renderItem(payload, authStatusView, ctx);
  },
});
