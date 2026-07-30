import { z } from "zod";

export const Setting = z
  .object({
    key: z.string(),
    value: z.unknown(),
    is_env_setting: z.boolean(),
    env_name: z.string(),
    description: z.string(),
    default: z.unknown(),
  })
  .loose();
export type Setting = z.infer<typeof Setting>;

export const SettingCompact = Setting.pick({
  key: true,
  value: true,
  is_env_setting: true,
  env_name: true,
}).strip();
export type SettingCompact = z.infer<typeof SettingCompact>;

export const SettingValue = z.object({
  key: z.string(),
  value: z.unknown(),
});
export type SettingValue = z.infer<typeof SettingValue>;
