import "./index.css";
import "./zod-setup";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { rde } from "./bridge";
import { applyChrome } from "./chrome";
import { Shell } from "./components/Shell";
import { applyTheme } from "./theme";

const ROOT_ID = "root";

function mountPoint(): HTMLElement {
  const element = document.getElementById(ROOT_ID);
  if (element === null) {
    throw new Error(`Renderer document has no #${ROOT_ID} element`);
  }
  return element;
}

async function start(): Promise<void> {
  const [settings, chrome] = await Promise.all([rde.settingsRead(), rde.windowChrome()]);
  applyTheme(settings.theme);
  applyChrome(chrome);
  createRoot(mountPoint()).render(
    <StrictMode>
      <Shell initialSettings={settings} />
    </StrictMode>,
  );
}

void start();
