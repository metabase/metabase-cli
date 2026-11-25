import { featureAvailability, type FeatureName } from "@metabase/client/version/features";

const MERGE_FEATURE = "remoteSyncMerge" satisfies FeatureName;

type SyncRun = "import" | "export";

export function mergeRefusal(run: SyncRun): string {
  return `\`--merge\` is refused (exit 2) on a server without \`${MERGE_FEATURE}\` (${featureAvailability(MERGE_FEATURE)}), which would run a plain ${run} instead.`;
}
