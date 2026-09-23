export const SETTINGS_SECTIONS = ["metabase", "repository", "agents", "appearance"] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const SETTINGS_SECTION_TITLES: Readonly<Record<SettingsSection, string>> = {
  metabase: "Metabase",
  repository: "Repository",
  agents: "Agents",
  appearance: "Appearance",
};
