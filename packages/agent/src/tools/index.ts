import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { browseCollectionTool } from "./browse-collection";
import { browseDataTool } from "./browse-data";
import { supportsCapabilities, type ToolCapabilities } from "./capability";
import { collectionWriteTool } from "./collection-write";
import { dashboardWriteTool } from "./dashboard-write";
import { measureWriteTool, segmentWriteTool, snippetWriteTool } from "./definitions-write";
import type { MetabaseToolDeps } from "./deps";
import { documentWriteTool } from "./document-write";
import { duplicateContentTool } from "./duplicate-content";
import { executeQueryTool } from "./execute-query";
import { executeSqlTool } from "./execute-sql";
import { getContentTool } from "./get-content";
import { getParameterValuesTool } from "./get-parameter-values";
import { GIT_SYNC_CAPABILITIES, gitSyncTool } from "./git-sync";
import { instanceSettingsTool } from "./instance-settings";
import { LIBRARY_CAPABILITIES, libraryTool } from "./library";
import { metadataWriteTool } from "./metadata-write";
import { questionWriteTool } from "./question-write";
import { withRenderers } from "../tui/tool-render";
import { runSavedQuestionTool } from "./run-saved-question";
import { searchTool } from "./search";
import { timelineWriteTool } from "./timeline-write";
import { transformJobWriteTool } from "./transform-job-write";
import { transformRunTool } from "./transform-run";
import { TRANSFORM_CAPABILITIES, transformWriteTool } from "./transform-write";
import { uploadCsvTool } from "./upload-csv";

export type { MetabaseToolDeps } from "./deps";

type ToolFactory = (deps: MetabaseToolDeps) => ToolDefinition;

interface GatedTool {
  build: ToolFactory;
  requires: ToolCapabilities;
}

const UNIVERSAL: ToolFactory[] = [
  searchTool,
  browseDataTool,
  browseCollectionTool,
  getContentTool,
  getParameterValuesTool,
  executeQueryTool,
  executeSqlTool,
  runSavedQuestionTool,
  questionWriteTool,
  dashboardWriteTool,
  collectionWriteTool,
  duplicateContentTool,
  documentWriteTool,
  snippetWriteTool,
  segmentWriteTool,
  measureWriteTool,
  timelineWriteTool,
  metadataWriteTool,
  uploadCsvTool,
  instanceSettingsTool,
];

// A tool the instance cannot run is worse than a missing one: the model spends a call, and a
// rejection, learning that transforms need v59. The probe already knows, so the tool never appears.
// An unprobed instance refutes nothing — everything is offered, and each tool's own preflight
// answers once the instance is known.
const GATED: GatedTool[] = [
  { build: transformWriteTool, requires: TRANSFORM_CAPABILITIES },
  { build: transformRunTool, requires: TRANSFORM_CAPABILITIES },
  { build: transformJobWriteTool, requires: TRANSFORM_CAPABILITIES },
  { build: gitSyncTool, requires: GIT_SYNC_CAPABILITIES },
  { build: libraryTool, requires: LIBRARY_CAPABILITIES },
];

export function metabaseTools(deps: MetabaseToolDeps): ToolDefinition[] {
  const gated = GATED.filter((tool) => supportsCapabilities(deps.instance, tool.requires)).map(
    (tool) => tool.build,
  );
  return [...UNIVERSAL, ...gated].map((build) => withRenderers(build(deps), deps.instance.url));
}
