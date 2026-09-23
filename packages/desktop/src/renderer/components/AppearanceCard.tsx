import type { ReactElement } from "react";

import { ThemePreference } from "../../contracts/settings";
import type { SettingsView } from "../../contracts/settings";
import { rde } from "@/bridge";
import { requestFailure, useRequest } from "@/request";
import { applyTheme } from "@/theme";

import { Note } from "./Note";
import type { SaveOutcome } from "./SaveStatus";
import { SaveStatus } from "./SaveStatus";
import { DetailRow } from "./Detail";
import { SettingsCard } from "./SettingsCard";
import { Select } from "./ui/select";

const THEME_LABELS: Readonly<Record<ThemePreference, string>> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

interface AppearanceCardProps {
  readonly settings: SettingsView;
  readonly onSettings: (settings: SettingsView) => void;
}

export function AppearanceCard({ settings, onSettings }: AppearanceCardProps): ReactElement {
  const save = useRequest<SaveOutcome>();
  const failure = requestFailure(save.state);

  const choose = (value: string): void => {
    const parsed = ThemePreference.safeParse(value);
    if (!parsed.success) {
      return;
    }
    const theme = parsed.data;
    void save.send(async () => {
      const next = await rde.settingsSetTheme({ theme });
      applyTheme(next.theme);
      onSettings(next);
      return "saved";
    });
  };

  return (
    <SettingsCard
      section="appearance"
      status={<SaveStatus state={save.state} pendingLabel="Saving" />}
    >
      <DetailRow label="Theme">
        <Select
          aria-label="Theme"
          className="w-auto"
          value={settings.themePreference}
          disabled={save.state.status === "running"}
          onChange={(event) => {
            choose(event.target.value);
          }}
        >
          {ThemePreference.options.map((choice) => (
            <option key={choice} value={choice}>
              {THEME_LABELS[choice]}
            </option>
          ))}
        </Select>
      </DetailRow>
      {failure === null ? null : <Note tone="error">{failure}</Note>}
    </SettingsCard>
  );
}
