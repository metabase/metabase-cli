export const DEFAULT_ARCHIVE_REVISION_MESSAGE = "Archived via metabase CLI";

export const revisionMessageFlag = {
  revisionMessage: {
    type: "string",
    description: "Audit-log message recorded with the change",
    alias: "revision-message",
    default: DEFAULT_ARCHIVE_REVISION_MESSAGE,
  },
} as const;
