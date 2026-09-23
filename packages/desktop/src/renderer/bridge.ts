import type { IpcBridge } from "../contracts/ipc";

declare global {
  interface Window {
    readonly rde: IpcBridge;
  }
}

export const rde: IpcBridge = window.rde;
