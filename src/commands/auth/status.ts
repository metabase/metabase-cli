import { z } from "zod";

import { readProfileRecord } from "../../core/auth/storage";
import { resolveProfileName } from "../../core/config";
import { originOnly } from "../../core/url";
import { ParsedVersionSchema } from "../../core/version/tag";
import { ProbedUser, ProfileLastFailure } from "../../core/auth/profile-record";
import { TokenFeatures } from "../../domain/session-properties";
import type { ResourceView } from "../../domain/view";
import { Edition } from "../../runtime/capabilities";
import { renderItem } from "../../output/render";
import { outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import {
  renderEditionLabel,
  renderTimestamp,
  renderUserName,
  renderUserRole,
  renderVersionTag,
} from "./render";

export const AuthStatus = z.object({
  profile: z.string(),
  present: z.boolean(),
  url: z.string().nullable(),
  user: ProbedUser.nullable(),
  version: ParsedVersionSchema.nullable(),
  edition: Edition.nullable(),
  tokenFeatures: TokenFeatures.nullable(),
  lastProbedAt: z.iso.datetime().nullable(),
  lastFailure: ProfileLastFailure.nullable(),
});
export type AuthStatusJson = z.infer<typeof AuthStatus>;

const authStatusView: ResourceView<AuthStatusJson> = {
  compactPick: AuthStatus,
  tableColumns: [
    { key: "profile", label: "Profile" },
    { key: "present", label: "Authenticated" },
    { key: "url", label: "URL" },
    { key: "user", label: "Logged in as", format: (value) => renderUserName(value) },
    { key: "user", label: "Role", format: (value) => renderUserRole(value) },
    { key: "version", label: "Version", format: (value) => renderVersionTag(value) },
    { key: "edition", label: "Edition", format: (value) => renderEditionLabel(value) },
    { key: "lastProbedAt", label: "Last probed", format: (value) => renderTimestamp(value) },
  ],
};

export default defineMetabaseCommand({
  meta: { name: "status", description: "Show authentication status for a profile" },
  capabilities: { minVersion: 58, edition: "oss" },
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
          user: null,
          version: null,
          edition: null,
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
        url: originOnly(record.url),
        user: probe?.user ?? null,
        version: probe?.version ?? null,
        edition: probe?.edition ?? null,
        tokenFeatures: probe?.tokenFeatures ?? null,
        lastProbedAt: probe?.at ?? null,
        lastFailure: record.lastFailure,
      },
      authStatusView,
      ctx,
    );
  },
});
