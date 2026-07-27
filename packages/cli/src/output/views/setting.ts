import { type Setting, SettingCompact, SettingValue } from "@metabase/client/domain/setting";

import type { ResourceView } from "../view";

export const settingView: ResourceView<Setting> = {
  compactPick: SettingCompact,
  tableColumns: [
    { key: "key", label: "Key" },
    { key: "value", label: "Value" },
    { key: "is_env_setting", label: "From env" },
    { key: "env_name", label: "Env name" },
  ],
};

export const settingValueView: ResourceView<SettingValue> = {
  compactPick: SettingValue,
  tableColumns: [
    { key: "key", label: "Key" },
    { key: "value", label: "Value" },
  ],
};
