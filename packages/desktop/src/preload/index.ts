import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import { createIpcBridge } from "../contracts/ipc";

const BRIDGE_NAME = "rde";

const bridge = createIpcBridge(
  (channel, payload) => ipcRenderer.invoke(channel, payload),
  (channel, listener) => {
    const handler = (_event: IpcRendererEvent, payload: unknown): void => {
      listener(payload);
    };
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.off(channel, handler);
    };
  },
);

contextBridge.exposeInMainWorld(BRIDGE_NAME, bridge);
