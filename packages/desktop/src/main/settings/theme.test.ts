import { describe, expect, it } from "vitest";

import { THEME_ENV_VAR, readThemeOverride, resolveTheme } from "./theme";

const NO_ENV: NodeJS.ProcessEnv = {};

describe("resolveTheme", () => {
  it("takes the preference when it names a theme", () => {
    expect(resolveTheme({ preference: "dark", systemTheme: "light", env: NO_ENV })).toBe("dark");
  });

  it("follows the system theme when the preference is system", () => {
    expect(resolveTheme({ preference: "system", systemTheme: "dark", env: NO_ENV })).toBe("dark");
  });

  it("lets the environment override the preference", () => {
    expect(
      resolveTheme({ preference: "dark", systemTheme: "dark", env: { [THEME_ENV_VAR]: "light" } }),
    ).toBe("light");
  });
});

describe("readThemeOverride", () => {
  it("is null when the variable is unset", () => {
    expect(readThemeOverride(NO_ENV)).toBe(null);
  });

  it("refuses a theme it does not know", () => {
    expect(() => readThemeOverride({ [THEME_ENV_VAR]: "sepia" })).toThrow(
      'RDE_THEME is "sepia"; expected one of light, dark',
    );
  });
});
