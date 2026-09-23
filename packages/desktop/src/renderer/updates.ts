import type { UpdateState } from "../contracts/updates";
import { assertNever } from "../contracts/assert-never";

export type UpdateAction = "download" | "install";

export interface UpdateToastAction {
  readonly kind: UpdateAction;
  readonly label: string;
}

// `key` names what the toast is about, so dismissing it hides that one and the next state, a
// finished download after the offer, shows again.
export interface UpdateToastView {
  readonly key: string;
  readonly message: string;
  readonly action: UpdateToastAction | null;
}

const PRODUCT_NAME = "RDE";

export function updateToast(state: UpdateState): UpdateToastView | null {
  switch (state.kind) {
    case "off":
    case "idle":
    case "checking":
    case "current": {
      return null;
    }
    case "available": {
      return {
        key: `available:${state.version}`,
        message: `${PRODUCT_NAME} ${state.version} is available.`,
        action: { kind: "download", label: "Download" },
      };
    }
    case "downloading": {
      return {
        key: `downloading:${state.version}`,
        message: `Downloading ${state.version}: ${String(Math.floor(state.percent))}%`,
        action: null,
      };
    }
    case "ready": {
      return {
        key: `ready:${state.version}`,
        message: `${PRODUCT_NAME} ${state.version} is ready. Restart to update.`,
        action: { kind: "install", label: "Restart" },
      };
    }
    case "error": {
      if (state.step === "check") {
        return null;
      }
      return {
        key: `error:${state.message}`,
        message: `The update did not download: ${state.message}`,
        action: null,
      };
    }
    default: {
      return assertNever(state);
    }
  }
}
