import { describe, expect, it } from "vitest";

import {
  IpcContractError,
  IpcRemoteError,
  createIpcBridge,
  ipc,
  ipcHandler,
  type IpcSubscribe,
} from "./ipc";

const NO_EVENT = null;

const NO_SUBSCRIPTIONS: IpcSubscribe = () => () => undefined;

const UNREACHABLE = { kind: "unreachable", message: "connection refused" } as const;

describe("ipcHandler", () => {
  it("rejects a payload that fails the channel's input schema, naming the channel", async () => {
    const listener = ipcHandler(ipc.connectionProbe, async () => UNREACHABLE);

    const rejection = listener(NO_EVENT, { url: 42 });

    await expect(rejection).rejects.toBeInstanceOf(IpcContractError);
    await expect(rejection).rejects.toThrow(
      'IPC channel "connection.probe" rejected its input: url: Invalid input: expected string, received number',
    );
  });

  it("rejects a handler result that fails the channel's output schema", async () => {
    const listener = ipcHandler(ipc.connectionProbe, async () => ({
      ...UNREACHABLE,
      extra: 1,
    }));

    await expect(listener(NO_EVENT, { url: "https://mb.example.com" })).rejects.toThrow(
      'IPC channel "connection.probe" rejected its output: (root): Unrecognized key: "extra"',
    );
  });

  it("returns the parsed output for a valid round trip", async () => {
    const listener = ipcHandler(ipc.connectionProbe, async () => UNREACHABLE);

    await expect(listener(NO_EVENT, { url: "https://mb.example.com" })).resolves.toEqual(
      UNREACHABLE,
    );
  });
});

describe("createIpcBridge", () => {
  it("sends the channel name and payload through the transport and parses the reply", async () => {
    const sent: Array<[string, unknown]> = [];
    const bridge = createIpcBridge(async (channel, payload) => {
      sent.push([channel, payload]);
      return UNREACHABLE;
    }, NO_SUBSCRIPTIONS);

    await expect(bridge.connectionProbe({ url: "https://mb.example.com" })).resolves.toEqual(
      UNREACHABLE,
    );
    expect(sent).toEqual([["connection.probe", { url: "https://mb.example.com" }]]);
  });

  it("rejects a reply that fails the channel's output schema, naming the channel", async () => {
    const bridge = createIpcBridge(async () => ({ kind: "unreachable" }), NO_SUBSCRIPTIONS);

    await expect(bridge.connectionProbe({ url: "https://mb.example.com" })).rejects.toThrow(
      'IPC channel "connection.probe" rejected its output: message: Invalid input: expected string, received undefined',
    );
  });

  it("hands the page main's own message without Electron's framing or the error's class", async () => {
    const bridge = createIpcBridge(async () => {
      throw new Error(
        "Error invoking remote method 'branch.status': GitFailure: The session's folder is gone.",
      );
    }, NO_SUBSCRIPTIONS);

    const rejection = bridge.branchStatus({ sessionId: "ses_1" });

    await expect(rejection).rejects.toBeInstanceOf(IpcRemoteError);
    await expect(rejection).rejects.toHaveProperty("message", "The session's folder is gone.");
  });
});
