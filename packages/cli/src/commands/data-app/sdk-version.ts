import { z } from "zod";

import { parseTag } from "@metabase/client/version/tag";

import {
  EMBEDDING_SDK_PACKAGE,
  pickSdkRelease,
  requireReleaseBuild,
  SdkRelease,
} from "../../core/embedding-sdk";
import { fetchNpmDistTags } from "../../core/npm-registry";
import { renderSummary } from "../../output/render";
import type { ResourceView } from "../../output/view";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { distTagsOptions, registryFlag } from "../registry-flag";
import { defineMetabaseCommand } from "../runtime";

export const SdkVersionResult = z.object({
  metabaseVersion: z.string(),
  ...SdkRelease.shape,
});
type SdkVersionResult = z.infer<typeof SdkVersionResult>;

const sdkVersionView: ResourceView<SdkVersionResult> = {
  compactPick: SdkVersionResult,
  tableColumns: [
    { key: "metabaseVersion", label: "Metabase" },
    { key: "tag", label: "SDK tag" },
    { key: "version", label: "SDK version" },
  ],
};

export default defineMetabaseCommand({
  meta: {
    name: "sdk-version",
    description: "Name the Embedding SDK tag that matches the instance's Metabase version",
  },
  details: `Reads the instance's version afresh and the npm dist-tags of ${EMBEDDING_SDK_PACKAGE}, and answers the most mature tag published for that Metabase major: its stable tag (\`65-stable\` for v1.65.x), or while the major has none, its beta, then its alpha tag. Fails on a development build, which no published SDK matches, and on a major npm has no tag for. Text output is the bare tag, so the install composes in a shell.`,
  skills: [{ skill: "data-app", purpose: "installing the SDK in a scaffolded project" }],
  requires: ["session.properties"],
  args: { ...outputFlags, ...profileFlag, ...connectionFlags, ...registryFlag },
  outputSchema: SdkVersionResult,
  examples: [
    "mb data-app sdk-version",
    "mb data-app sdk-version --json",
    `TAG=$(mb data-app sdk-version --format text) && npm install "${EMBEDDING_SDK_PACKAGE}@$TAG"`,
  ],
  async run({ args, ctx, getClient }) {
    const client = await getClient();
    const properties = await client.session.properties();
    const server = requireReleaseBuild(parseTag(properties.version.tag));
    const distTags = await fetchNpmDistTags(EMBEDDING_SDK_PACKAGE, distTagsOptions(args.registry));
    const release = pickSdkRelease(server, distTags);
    renderSummary({ metabaseVersion: server.tag, ...release }, sdkVersionView, release.tag, ctx);
  },
});
