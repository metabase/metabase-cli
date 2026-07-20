import { z } from "zod";

import type { ResourceView } from "./view";

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

export const settingView: ResourceView<Setting> = {
  compactPick: SettingCompact,
  tableColumns: [
    { key: "key", label: "Key" },
    { key: "value", label: "Value" },
    { key: "is_env_setting", label: "From env" },
    { key: "env_name", label: "Env name" },
  ],
};

export const SettingValue = z.object({
  key: z.string(),
  value: z.unknown(),
});
export type SettingValue = z.infer<typeof SettingValue>;

export const settingValueView: ResourceView<SettingValue> = {
  compactPick: SettingValue,
  tableColumns: [
    { key: "key", label: "Key" },
    { key: "value", label: "Value" },
  ],
};
