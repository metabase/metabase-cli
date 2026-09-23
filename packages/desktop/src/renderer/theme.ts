import type { Theme } from "../contracts/settings";

const DARK_CLASS = "dark";
const THEME_ATTRIBUTE = "data-theme";

export function applyTheme(theme: Theme): void {
  const html = document.documentElement;
  html.classList.toggle(DARK_CLASS, theme === "dark");
  html.setAttribute(THEME_ATTRIBUTE, theme);
}
