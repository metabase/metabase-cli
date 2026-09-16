export const E2E_GROUPS = {
  ALL_USERS: 1,
  ADMIN: 2,
} as const;

// The transform jobs every server creates for itself, in creation order.
export const E2E_BUILTIN_TRANSFORM_JOBS = {
  HOURLY: 1,
  DAILY: 2,
} as const;
