import {
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  type TitleBarOverlay,
} from "electron";

import { assertNever } from "../contracts/assert-never";
import { LAYOUT_MIN_WIDTH } from "../contracts/layout";
import type { Theme } from "../contracts/settings";
import type { WindowChrome } from "../contracts/window";

export const WINDOW_TITLE = "RDE";

const WINDOW_WIDTH = 1440;
const WINDOW_HEIGHT = 900;
const WINDOW_MIN_HEIGHT = 600;

// The renderer's `WindowStrip` is `h-12`; the traffic lights centre on it and the overlay matches it.
const TOP_STRIP_HEIGHT_PX = 48;
const TRAFFIC_LIGHT_DIAMETER_PX = 14;
const TRAFFIC_LIGHTS_MARGIN_PX = 16;
const TRAFFIC_LIGHTS_WIDTH_PX = 52;
const TRAFFIC_LIGHT_POSITION = {
  x: TRAFFIC_LIGHTS_MARGIN_PX,
  y: (TOP_STRIP_HEIGHT_PX - TRAFFIC_LIGHT_DIAMETER_PX) / 2,
};
const TRAFFIC_LIGHTS_INSET_PX = TRAFFIC_LIGHTS_MARGIN_PX + TRAFFIC_LIGHTS_WIDTH_PX;
const MACOS_PLATFORM = "darwin";

const OVERLAY_BACKGROUND = "#00000000";

interface ThemeColours {
  readonly page: string;
  readonly ink: string;
}

// The `--page` and `--ink` tokens of each theme: the window opens in the page's colour, and the
// overlay's buttons read like the app's own icons.
const THEME_COLOURS: Readonly<Record<Theme, ThemeColours>> = {
  light: { page: "#fafafb", ink: "#1f2124" },
  dark: { page: "#17181a", ink: "#f2f3f4" },
};

type ChromeOptions = Pick<
  BrowserWindowConstructorOptions,
  "titleBarStyle" | "titleBarOverlay" | "trafficLightPosition"
>;

export function windowChrome(platform: NodeJS.Platform): WindowChrome {
  if (platform === MACOS_PLATFORM) {
    return { kind: "traffic-lights", inset: TRAFFIC_LIGHTS_INSET_PX };
  }
  return { kind: "controls-overlay" };
}

function controlsOverlay(theme: Theme): TitleBarOverlay {
  return {
    color: OVERLAY_BACKGROUND,
    symbolColor: THEME_COLOURS[theme].ink,
    height: TOP_STRIP_HEIGHT_PX,
  };
}

export function chromeOptions(chrome: WindowChrome, theme: Theme): ChromeOptions {
  switch (chrome.kind) {
    case "traffic-lights": {
      return { titleBarStyle: "hiddenInset", trafficLightPosition: TRAFFIC_LIGHT_POSITION };
    }
    case "controls-overlay": {
      return { titleBarStyle: "hidden", titleBarOverlay: controlsOverlay(theme) };
    }
    default: {
      return assertNever(chrome);
    }
  }
}

// The traffic lights follow the system appearance on their own; the overlay's symbols are drawn in
// the colour the app hands it.
export function applyWindowTheme(window: BrowserWindow, chrome: WindowChrome, theme: Theme): void {
  window.setBackgroundColor(THEME_COLOURS[theme].page);
  if (chrome.kind === "controls-overlay") {
    window.setTitleBarOverlay(controlsOverlay(theme));
  }
}

interface DevServerEntry {
  readonly kind: "dev-server";
  readonly url: string;
}

interface BuiltFileEntry {
  readonly kind: "built-file";
  readonly path: string;
}

export type RendererEntry = DevServerEntry | BuiltFileEntry;

export interface MainWindowOptions {
  readonly entry: RendererEntry;
  readonly preloadPath: string;
  readonly chrome: WindowChrome;
  readonly theme: Theme;
  readonly icon: string;
  readonly openUrl: (url: string) => Promise<boolean>;
}

const WEB_URL_PREFIXES = ["http://", "https://"];

function isWebUrl(url: string): boolean {
  return WEB_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

function openInBrowser(options: MainWindowOptions, url: string): void {
  if (isWebUrl(url)) {
    void options.openUrl(url);
  }
}

function loadEntry(window: BrowserWindow, entry: RendererEntry): void {
  if (entry.kind === "dev-server") {
    void window.loadURL(entry.url);
    return;
  }
  void window.loadFile(entry.path);
}

export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    title: WINDOW_TITLE,
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: LAYOUT_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    // Shown at once over the page's colour. A window with the controls overlay that stays hidden
    // until `ready-to-show` intermittently stops drawing frames on X11 until it is next resized.
    show: true,
    backgroundColor: THEME_COLOURS[options.theme].page,
    autoHideMenuBar: true,
    icon: options.icon,
    ...chromeOptions(options.chrome, options.theme),
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    openInBrowser(options, url);
    return { action: "deny" };
  });

  // The app is one document; every navigation request is a link leaving it.
  window.webContents.on("will-navigate", (event, url) => {
    event.preventDefault();
    openInBrowser(options, url);
  });

  loadEntry(window, options.entry);
  return window;
}
