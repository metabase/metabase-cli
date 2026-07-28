import { z } from "zod";

import { TokenFeatures } from "@metabase/client/domain/session-properties";
import { displayUrl } from "@metabase/client/url";
import { ParsedVersion } from "@metabase/client/version/tag";

import { readProfileRecord } from "../../core/auth/storage";
import { resolveProfileName } from "../../core/config";
import {
  ProbedUser,
  profileAuthMethod,
  ProfileAuthMethod,
  ProfileLastFailure,
} from "../../core/auth/profile-record";
import { renderItem } from "../../output/render";
import type { ResourceView } from "../../output/view";
import { outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import {
  renderAuthMethod,
  renderTimestamp,
  renderUserName,
  renderUserRole,
  renderVersionTag,
} from "./render";

export const AuthStatus = z.object({
  profile: z.string(),
  present: z.boolean(),
  url: z.string().nullable(),
  method: ProfileAuthMethod.nullable(),
  user: ProbedUser.nullable(),
  version: ParsedVersion.nullable(),
  tokenFeatures: TokenFeatures.nullable(),
  lastProbedAt: z.iso.datetime().nullable(),
  lastFailure: ProfileLastFailure.nullable(),
});
type AuthStatusJson = z.infer<typeof AuthStatus>;

const authStatusView: ResourceView<AuthStatusJson> = {
  compactPick: AuthStatus,
  tableColumns: [
    { key: "profile", label: "Profile" },
    { key: "present", label: "Authenticated" },
    { key: "url", label: "URL" },
    { key: "method", label: "Auth", format: (value) => renderAuthMethod(value) },
    { key: "user", label: "Logged in as", format: (value) => renderUserName(value) },
    { key: "user", label: "Role", format: (value) => renderUserRole(value) },
    { key: "version", label: "Version", format: (value) => renderVersionTag(value) },
    { key: "lastProbedAt", label: "Last probed", format: (value) => renderTimestamp(value) },
  ],
};

export default defineMetabaseCommand({
  meta: { name: "status", description: "Show authentication status for a profile" },
  capabilities: null,
  args: { ...outputFlags, ...profileFlag },
  outputSchema: AuthStatus,
  examples: ["mb auth status --json", "mb auth status --profile staging"],
  async run({ args, ctx }) {
    const profileName = resolveProfileName(args.profile);
    const record = await readProfileRecord(profileName);

    if (record === null) {
      renderItem(
        {
          profile: profileName,
          present: false,
          url: null,
          method: null,
          user: null,
          version: null,
          tokenFeatures: null,
          lastProbedAt: null,
          lastFailure: null,
        },
        authStatusView,
        ctx,
      );
      return;
    }

    const probe = record.lastProbe;
    renderItem(
      {
        profile: profileName,
        present: true,
        url: displayUrl(record.url),
        method: profileAuthMethod(record),
        user: probe?.user ?? null,
        version: probe?.version ?? null,
        tokenFeatures: probe?.tokenFeatures ?? null,
        lastProbedAt: probe?.at ?? null,
        lastFailure: record.lastFailure,
      },
      authStatusView,
      ctx,
    );
  },
});
