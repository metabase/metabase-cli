import { Theme, type ThemePreference } from "../../contracts/settings";

export const THEME_ENV_VAR = "RDE_THEME";

interface ThemeResolution {
  readonly preference: ThemePreference;
  readonly systemTheme: Theme;
  readonly env: NodeJS.ProcessEnv;
}

export function readThemeOverride(env: NodeJS.ProcessEnv): Theme | null {
  const raw = env[THEME_ENV_VAR];
  if (raw === undefined) {
    return null;
  }
  const parsed = Theme.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`${THEME_ENV_VAR} is "${raw}"; expected one of ${Theme.options.join(", ")}`);
  }
  return parsed.data;
}

export function resolveTheme(resolution: ThemeResolution): Theme {
  const override = readThemeOverride(resolution.env);
  if (override !== null) {
    return override;
  }
  if (resolution.preference === "system") {
    return resolution.systemTheme;
  }
  return resolution.preference;
}
