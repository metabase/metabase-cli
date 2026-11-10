import { z } from "zod";

export const CurrentUser = z
  .object({
    id: z.number().int(),
    // Metabase's own check admits addresses a stricter one refuses, such as `a!b@host.1`.
    email: z.string(),
    common_name: z.string(),
    is_superuser: z.boolean(),
  })
  .loose();
export type CurrentUser = z.infer<typeof CurrentUser>;

export const CurrentUserCompact = CurrentUser.pick({
  id: true,
  email: true,
  common_name: true,
  is_superuser: true,
}).strip();
export type CurrentUserCompact = z.infer<typeof CurrentUserCompact>;

// The columns depend on the caller: everyone sees the id, email and names, a group manager also
// `is_superuser`, and an admin also `is_active`.
export const User = z
  .object({
    id: z.number().int(),
    // Metabase's own check admits addresses a stricter one refuses, such as `a!b@host.1`.
    email: z.string(),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    common_name: z.string(),
    is_superuser: z.boolean().optional(),
    is_active: z.boolean().optional(),
  })
  .loose();
export type User = z.infer<typeof User>;

export const UserCompact = User.pick({
  id: true,
  email: true,
  common_name: true,
  is_superuser: true,
}).strip();
export type UserCompact = z.infer<typeof UserCompact>;

export const UserListStatus = z.enum(["active", "deactivated", "all"]);
export type UserListStatus = z.infer<typeof UserListStatus>;

export const UserCreateInput = z
  .object({
    first_name: z.string().min(1).nullable().optional(),
    last_name: z.string().min(1).nullable().optional(),
    email: z.string(),
    password: z.string().min(1).nullable().optional(),
  })
  .strict();
export type UserCreateInput = z.infer<typeof UserCreateInput>;
